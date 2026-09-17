import { getDatabase } from '../../db/index.js';
import { PAYING_PURCHASE_MATCH } from './getDashboardData.js';
import { purchaseNotFullyRefundedFilter } from '../refund/purchaseRefundHelpers.js';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  SEARCH_STRATEGY_MATCH_CAP,
  buildPaginationMeta,
  compareBySortSpec,
  computeBusinessStatusFlags,
  isStatusSort,
  resolveEffectivePage,
  resolveLimit,
  resolveSortKey,
  resolveSortSpec,
  statusRankForFlag,
  statusSortConfig,
} from './customerListParams.js';

export {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  SEARCH_STRATEGY_MATCH_CAP,
} from './customerListParams.js';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Fields never returned in list/search responses. */
const LIST_OMIT_PROJECTION = {
  passwordHash: 0,
  emailVerificationTokenHash: 0,
  emailVerificationTokenExpiresAt: 0,
  passwordResetTokenHash: 0,
  passwordResetTokenExpiresAt: 0,
  acquisition: 0,
  billingAddress: 0,
  billingName: 0,
};

function stripSensitive(user) {
  if (!user) return null;
  const {
    passwordHash: _ph,
    emailVerificationTokenHash: _evh,
    emailVerificationTokenExpiresAt: _eve,
    passwordResetTokenHash: _prh,
    passwordResetTokenExpiresAt: _pre,
    acquisition: _acq,
    billingAddress: _ba,
    billingName: _bn,
    qualifyingPurchases: _qp,
    _statusRank: _sr,
    _verified: _v,
    _paying: _p,
    _activeSub: _a,
    _isTest: _t,
    ...rest
  } = user;
  return rest;
}

/**
 * Enrich list rows with compact status flags used by the admin UI.
 * Matches status-sort definitions: test users are never paying / active-sub.
 */
export function enrichCustomerListRow(user, { payingUserIds = new Set(), now = new Date() } = {}) {
  const clean = stripSensitive(user);
  const idStr = clean._id?.toString?.() || String(clean._id);
  const flags = computeBusinessStatusFlags(clean, {
    isPaying: payingUserIds.has(idStr),
    now,
  });
  return {
    _id: clean._id,
    email: clean.email || null,
    firstName: clean.firstName || null,
    lastName: clean.lastName || null,
    createdAt: clean.createdAt || null,
    stripeCustomerId: clean.stripeCustomerId || null,
    role: clean.role || null,
    markedForReview: !!clean.markedForReview,
    isTest: flags.isTest,
    emailVerified: flags.emailVerified,
    payingCustomer: flags.payingCustomer,
    subscriptionActive: flags.subscriptionActive,
  };
}

async function payingUserIdSet(db, userIds) {
  if (!userIds.length) return new Set();
  const rows = await db
    .collection('purchases')
    .aggregate([
      {
        $match: {
          ...PAYING_PURCHASE_MATCH,
          userId: { $in: userIds },
        },
      },
      { $group: { _id: '$userId' } },
    ])
    .toArray();
  return new Set(rows.map((r) => r._id.toString()));
}

/** Lookup pipeline: does this user have ≥1 qualifying purchase? */
function qualifyingPurchaseLookup() {
  return {
    $lookup: {
      from: 'purchases',
      let: { uid: '$_id' },
      pipeline: [
        {
          $match: {
            $and: [
              { $expr: { $eq: ['$userId', '$$uid'] } },
              { isTest: { $ne: true } },
              { amount: { $type: 'number', $gt: 0 } },
              purchaseNotFullyRefundedFilter,
            ],
          },
        },
        { $limit: 1 },
        { $project: { _id: 1 } },
      ],
      as: 'qualifyingPurchases',
    },
  };
}

function statusRankAddFields(sortKey, now) {
  const cfg = statusSortConfig(sortKey);
  // preferTrue → true maps to 0 via $cond
  const preferTrue = cfg?.preferTrue !== false;

  return {
    $addFields: {
      _isTest: { $eq: ['$isTest', true] },
      _verified: { $eq: [{ $type: '$emailVerifiedAt' }, 'date'] },
      _paying: {
        $and: [
          { $ne: ['$isTest', true] },
          { $gt: [{ $size: '$qualifyingPurchases' }, 0] },
        ],
      },
      _activeSub: {
        $and: [
          { $ne: ['$isTest', true] },
          { $eq: ['$subscriptionStatus', 'active'] },
          { $gt: ['$subscriptionCurrentPeriodEnd', now] },
        ],
      },
      _statusRank: (() => {
        if (!cfg) return 0;
        const flagExpr =
          cfg.flag === 'emailVerified'
            ? { $eq: [{ $type: '$emailVerifiedAt' }, 'date'] }
            : cfg.flag === 'payingCustomer'
              ? {
                  $and: [
                    { $ne: ['$isTest', true] },
                    { $gt: [{ $size: '$qualifyingPurchases' }, 0] },
                  ],
                }
              : {
                  $and: [
                    { $ne: ['$isTest', true] },
                    { $eq: ['$subscriptionStatus', 'active'] },
                    { $gt: ['$subscriptionCurrentPeriodEnd', now] },
                  ],
                };
        // preferTrue: true→0, false→1; reverse: true→1, false→0
        return preferTrue
          ? { $cond: [flagExpr, 0, 1] }
          : { $cond: [flagExpr, 1, 0] };
      })(),
    },
  };
}

/**
 * Browse-all with status sort via aggregation across the full user set, then paginate.
 */
async function browseCustomersByStatus({ page, limit, sortKey, now }) {
  const db = getDatabase();
  const limitNum = resolveLimit(limit);

  const countPipeline = [
    qualifyingPurchaseLookup(),
    statusRankAddFields(sortKey, now),
    { $count: 'total' },
  ];
  const countRows = await db.collection('users').aggregate(countPipeline).toArray();
  const total = countRows[0]?.total ?? 0;
  const pageNum = resolveEffectivePage(page, total, limitNum);
  const skip = (pageNum - 1) * limitNum;

  const pagePipeline = [
    qualifyingPurchaseLookup(),
    statusRankAddFields(sortKey, now),
    { $sort: { _statusRank: 1, createdAt: -1, _id: -1 } },
    { $skip: skip },
    { $limit: limitNum },
    {
      $project: {
        ...LIST_OMIT_PROJECTION,
        qualifyingPurchases: 0,
        _statusRank: 0,
        _verified: 0,
        _paying: 0,
        _activeSub: 0,
        _isTest: 0,
      },
    },
  ];

  const docs = await db.collection('users').aggregate(pagePipeline).toArray();
  const paying = await payingUserIdSet(
    db,
    docs.map((u) => u._id)
  );
  const customers = docs.map((u) => enrichCustomerListRow(u, { payingUserIds: paying, now }));

  return {
    customers,
    pagination: buildPaginationMeta({
      page: pageNum,
      limit: limitNum,
      total,
      sort: sortKey,
    }),
  };
}

/**
 * Browse all account records with server-side sort then pagination.
 */
export async function browseCustomers({
  page = 1,
  limit = DEFAULT_PAGE_SIZE,
  sort = undefined,
  now = new Date(),
} = {}) {
  const sortKey = resolveSortKey(sort);
  if (isStatusSort(sortKey)) {
    return browseCustomersByStatus({ page, limit, sortKey, now });
  }

  const db = getDatabase();
  const limitNum = resolveLimit(limit);
  const sortSpec = resolveSortSpec(sortKey);

  const usersCol = db.collection('users');
  const total = await usersCol.countDocuments({});
  const pageNum = resolveEffectivePage(page, total, limitNum);
  const skip = (pageNum - 1) * limitNum;

  const docs = await usersCol
    .find({})
    .project(LIST_OMIT_PROJECTION)
    .sort(sortSpec)
    .skip(skip)
    .limit(limitNum)
    .toArray();

  const paying = await payingUserIdSet(
    db,
    docs.map((u) => u._id)
  );
  const customers = docs.map((u) => enrichCustomerListRow(u, { payingUserIds: paying, now }));

  return {
    customers,
    pagination: buildPaginationMeta({
      page: pageNum,
      limit: limitNum,
      total,
      sort: sortKey,
    }),
  };
}

function sortSearchResults(docs, sortKey, payingIds, now) {
  if (isStatusSort(sortKey)) {
    const cfg = statusSortConfig(sortKey);
    const decorated = docs.map((u) => {
      const flags = computeBusinessStatusFlags(u, {
        isPaying: payingIds.has(u._id.toString()),
        now,
      });
      return {
        ...u,
        _statusRank: statusRankForFlag(flags[cfg.flag], cfg.preferTrue),
        ...flags,
      };
    });
    decorated.sort((a, b) =>
      compareBySortSpec(a, b, { _statusRank: 1, createdAt: -1, _id: -1 })
    );
    return decorated;
  }
  const sortSpec = resolveSortSpec(sortKey);
  return [...docs].sort((a, b) => compareBySortSpec(a, b, sortSpec));
}

/**
 * Search users by email, name, user id, Stripe customer id, purchase id, subscription id,
 * checkout session id, or payment intent id.
 *
 * Limitation: each identifier/text strategy uses SEARCH_STRATEGY_MATCH_CAP (50).
 * Combined search results may therefore be incomplete for very broad queries.
 * Empty-query browse-all is not subject to that cap.
 */
export async function searchCustomers(
  rawQuery,
  { page = 1, limit = DEFAULT_PAGE_SIZE, sort = undefined, now = new Date() } = {}
) {
  const db = getDatabase();
  const { ObjectId } = await import('mongodb');
  const q = (rawQuery || '').trim();
  const limitNum = resolveLimit(limit);
  const sortKey = resolveSortKey(sort);

  if (!q) {
    return browseCustomers({ page, limit: limitNum, sort: sortKey, now });
  }

  const byId = new Map();
  let searchPossiblyCapped = false;

  function addUser(user) {
    if (!user || !user._id) return;
    byId.set(user._id.toString(), stripSensitive(user));
  }

  async function limitedFind(cursorFactory) {
    const rows = await cursorFactory().limit(SEARCH_STRATEGY_MATCH_CAP).toArray();
    if (rows.length >= SEARCH_STRATEGY_MATCH_CAP) {
      searchPossiblyCapped = true;
    }
    return rows;
  }

  if (/^[a-fA-F0-9]{24}$/.test(q)) {
    try {
      const oid = new ObjectId(q);
      const user = await db.collection('users').findOne(
        { _id: oid },
        { projection: LIST_OMIT_PROJECTION }
      );
      addUser(user);

      const purchase = await db.collection('purchases').findOne({ _id: oid });
      if (purchase?.userId) {
        const u = await db.collection('users').findOne(
          { _id: purchase.userId },
          { projection: LIST_OMIT_PROJECTION }
        );
        addUser(u);
      }
    } catch {
      // invalid ObjectId
    }
  }

  if (q.startsWith('cus_')) {
    const users = await limitedFind(() =>
      db.collection('users').find({ stripeCustomerId: q }).project(LIST_OMIT_PROJECTION)
    );
    for (const u of users) addUser(u);
  }

  if (q.startsWith('sub_')) {
    const fromUsers = await limitedFind(() =>
      db.collection('users').find({ stripeSubscriptionId: q }).project(LIST_OMIT_PROJECTION)
    );
    for (const u of fromUsers) addUser(u);

    const purchases = await limitedFind(() =>
      db.collection('purchases').find({ stripeSubscriptionId: q })
    );
    for (const p of purchases) {
      if (p.userId) {
        const u = await db.collection('users').findOne(
          { _id: p.userId },
          { projection: LIST_OMIT_PROJECTION }
        );
        addUser(u);
      }
    }
  }

  if (q.startsWith('cs_')) {
    const purchases = await limitedFind(() =>
      db.collection('purchases').find({ stripeSessionId: q })
    );
    for (const p of purchases) {
      if (p.userId) {
        const u = await db.collection('users').findOne(
          { _id: p.userId },
          { projection: LIST_OMIT_PROJECTION }
        );
        addUser(u);
      }
    }
  }

  if (q.startsWith('pi_')) {
    const purchases = await limitedFind(() =>
      db.collection('purchases').find({ stripePaymentIntentId: q })
    );
    for (const p of purchases) {
      if (p.userId) {
        const u = await db.collection('users').findOne(
          { _id: p.userId },
          { projection: LIST_OMIT_PROJECTION }
        );
        addUser(u);
      }
    }
  }

  const safe = escapeRegex(q);
  const regex = new RegExp(safe, 'i');
  const textUsers = await limitedFind(() =>
    db
      .collection('users')
      .find({
        $or: [{ email: regex }, { firstName: regex }, { lastName: regex }],
      })
      .project(LIST_OMIT_PROJECTION)
  );
  for (const u of textUsers) addUser(u);

  const allDocs = Array.from(byId.values());
  const payingAll = await payingUserIdSet(
    db,
    allDocs.map((u) => u._id)
  );
  const sorted = sortSearchResults(allDocs, sortKey, payingAll, now);
  const total = sorted.length;
  const pageNum = resolveEffectivePage(page, total, limitNum);
  const skip = (pageNum - 1) * limitNum;
  const pageDocs = sorted.slice(skip, skip + limitNum);
  const customers = pageDocs.map((u) =>
    enrichCustomerListRow(u, { payingUserIds: payingAll, now })
  );

  const pagination = buildPaginationMeta({
    page: pageNum,
    limit: limitNum,
    total,
    sort: sortKey,
  });
  if (searchPossiblyCapped) {
    pagination.searchPossiblyCapped = true;
    pagination.searchStrategyMatchCap = SEARCH_STRATEGY_MATCH_CAP;
  }

  return { customers, pagination };
}
