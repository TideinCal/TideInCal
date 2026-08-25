import { getDatabase } from '../../db/index.js';
import { PAYING_PURCHASE_MATCH } from './getDashboardData.js';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  SEARCH_STRATEGY_MATCH_CAP,
  buildPaginationMeta,
  compareBySortSpec,
  resolveEffectivePage,
  resolveLimit,
  resolveSortKey,
  resolveSortSpec,
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
    ...rest
  } = user;
  return rest;
}

function isValidVerifiedAt(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isActiveSubscriber(user, now = new Date()) {
  const hasPeriodEnd =
    user.subscriptionCurrentPeriodEnd &&
    new Date(user.subscriptionCurrentPeriodEnd) > now;
  return user.subscriptionStatus === 'active' && !!hasPeriodEnd;
}

/**
 * Enrich list rows with compact status flags used by the admin UI.
 */
export function enrichCustomerListRow(user, { payingUserIds = new Set(), now = new Date() } = {}) {
  const clean = stripSensitive(user);
  const idStr = clean._id?.toString?.() || String(clean._id);
  return {
    _id: clean._id,
    email: clean.email || null,
    firstName: clean.firstName || null,
    lastName: clean.lastName || null,
    createdAt: clean.createdAt || null,
    stripeCustomerId: clean.stripeCustomerId || null,
    role: clean.role || null,
    markedForReview: !!clean.markedForReview,
    isTest: clean.isTest === true,
    emailVerified: isValidVerifiedAt(clean.emailVerifiedAt),
    payingCustomer: payingUserIds.has(idStr),
    subscriptionActive: isActiveSubscriber(clean, now),
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

/**
 * Browse all account records with server-side sort then pagination.
 */
export async function browseCustomers({
  page = 1,
  limit = DEFAULT_PAGE_SIZE,
  sort = undefined,
} = {}) {
  const db = getDatabase();
  const limitNum = resolveLimit(limit);
  const sortKey = resolveSortKey(sort);
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
  const customers = docs.map((u) => enrichCustomerListRow(u, { payingUserIds: paying }));

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
 * Search users by email, name, user id, Stripe customer id, purchase id, subscription id,
 * checkout session id, or payment intent id.
 *
 * Limitation: each identifier/text strategy uses SEARCH_STRATEGY_MATCH_CAP (50).
 * Combined search results may therefore be incomplete for very broad queries.
 * Empty-query browse-all is not subject to that cap.
 */
export async function searchCustomers(
  rawQuery,
  { page = 1, limit = DEFAULT_PAGE_SIZE, sort = undefined } = {}
) {
  const db = getDatabase();
  const { ObjectId } = await import('mongodb');
  const q = (rawQuery || '').trim();
  const limitNum = resolveLimit(limit);
  const sortKey = resolveSortKey(sort);
  const sortSpec = resolveSortSpec(sortKey);

  if (!q) {
    return browseCustomers({ page, limit: limitNum, sort: sortKey });
  }

  const byId = new Map();
  // Track whether any strategy hit the match cap (for metadata honesty).
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

  // MongoDB ObjectId (user or purchase)
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

  // Text: email, firstName, lastName
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

  const all = Array.from(byId.values()).sort((a, b) => compareBySortSpec(a, b, sortSpec));
  const total = all.length;
  const pageNum = resolveEffectivePage(page, total, limitNum);
  const skip = (pageNum - 1) * limitNum;
  const pageDocs = all.slice(skip, skip + limitNum);
  const paying = await payingUserIdSet(
    db,
    pageDocs.map((u) => u._id)
  );
  const customers = pageDocs.map((u) => enrichCustomerListRow(u, { payingUserIds: paying }));

  const pagination = buildPaginationMeta({
    page: pageNum,
    limit: limitNum,
    total,
    sort: sortKey,
  });
  // Document search-strategy cap when it may have truncated results.
  if (searchPossiblyCapped) {
    pagination.searchPossiblyCapped = true;
    pagination.searchStrategyMatchCap = SEARCH_STRATEGY_MATCH_CAP;
  }

  return {
    customers,
    pagination,
  };
}
