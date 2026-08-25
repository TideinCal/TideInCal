import { getDatabase } from '../../db/index.js';
import { PAYING_PURCHASE_MATCH } from './getDashboardData.js';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clampLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.floor(n));
}

function clampPage(page) {
  const n = Number(page);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
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

function paginationMeta(page, limit, total) {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasPrevious: page > 1 && total > 0,
    hasNext: totalPages > 0 && page < totalPages,
  };
}

/**
 * Browse all account records, newest first, with server-side pagination.
 */
export async function browseCustomers({ page = 1, limit = DEFAULT_PAGE_SIZE } = {}) {
  const db = getDatabase();
  const pageNum = clampPage(page);
  const limitNum = clampLimit(limit);
  const skip = (pageNum - 1) * limitNum;

  const usersCol = db.collection('users');
  const total = await usersCol.countDocuments({});
  const docs = await usersCol
    .find({})
    .project(LIST_OMIT_PROJECTION)
    .sort({ createdAt: -1, _id: -1 })
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
    pagination: paginationMeta(pageNum, limitNum, total),
  };
}

/**
 * Search users by email, name, user id, Stripe customer id, purchase id, subscription id,
 * checkout session id, or payment intent id. Returns de-duplicated enriched rows.
 */
export async function searchCustomers(rawQuery, { page = 1, limit = DEFAULT_PAGE_SIZE } = {}) {
  const db = getDatabase();
  const { ObjectId } = await import('mongodb');
  const q = (rawQuery || '').trim();
  const pageNum = clampPage(page);
  const limitNum = clampLimit(limit);

  if (!q) {
    return browseCustomers({ page: pageNum, limit: limitNum });
  }

  const byId = new Map();

  function addUser(user) {
    if (!user || !user._id) return;
    byId.set(user._id.toString(), stripSensitive(user));
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
    const users = await db
      .collection('users')
      .find({ stripeCustomerId: q })
      .project(LIST_OMIT_PROJECTION)
      .limit(50)
      .toArray();
    for (const u of users) addUser(u);
  }

  if (q.startsWith('sub_')) {
    const fromUsers = await db
      .collection('users')
      .find({ stripeSubscriptionId: q })
      .project(LIST_OMIT_PROJECTION)
      .limit(50)
      .toArray();
    for (const u of fromUsers) addUser(u);

    const purchases = await db
      .collection('purchases')
      .find({ stripeSubscriptionId: q })
      .limit(50)
      .toArray();
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
    const purchases = await db
      .collection('purchases')
      .find({ stripeSessionId: q })
      .limit(50)
      .toArray();
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
    const purchases = await db
      .collection('purchases')
      .find({ stripePaymentIntentId: q })
      .limit(50)
      .toArray();
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
  const textUsers = await db
    .collection('users')
    .find({
      $or: [{ email: regex }, { firstName: regex }, { lastName: regex }],
    })
    .project(LIST_OMIT_PROJECTION)
    .limit(50)
    .toArray();

  for (const u of textUsers) addUser(u);

  const all = Array.from(byId.values()).sort((a, b) => {
    const ac = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bc = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (bc !== ac) return bc - ac;
    return String(b._id).localeCompare(String(a._id));
  });

  const total = all.length;
  const skip = (pageNum - 1) * limitNum;
  const pageDocs = all.slice(skip, skip + limitNum);
  const paying = await payingUserIdSet(
    db,
    pageDocs.map((u) => u._id)
  );
  const customers = pageDocs.map((u) => enrichCustomerListRow(u, { payingUserIds: paying }));

  return {
    customers,
    pagination: paginationMeta(pageNum, limitNum, total),
  };
}
