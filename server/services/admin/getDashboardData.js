import { getDatabase } from '../../db/index.js';
import { purchaseNotFullyRefundedFilter } from '../refund/purchaseRefundHelpers.js';

/** Business totals exclude explicitly marked test accounts; missing isTest counts as business. */
export const BUSINESS_USER_FILTER = { isTest: { $ne: true } };

/** Purchase rows that can qualify a paying customer (Mongo match stage). */
export const PAYING_PURCHASE_MATCH = {
  isTest: { $ne: true },
  amount: { $type: 'number', $gt: 0 },
  userId: { $exists: true, $ne: null },
  $and: [purchaseNotFullyRefundedFilter],
};

/**
 * Count distinct non-test users who have at least one qualifying purchase.
 * Aggregation only — does not load all purchase documents into Node.
 */
export async function countPayingCustomers(db) {
  const pipeline = [
    { $match: PAYING_PURCHASE_MATCH },
    { $group: { _id: '$userId' } },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: '$user' },
    { $match: { 'user.isTest': { $ne: true } } },
    { $count: 'count' },
  ];
  const rows = await db.collection('purchases').aggregate(pipeline).toArray();
  return rows[0]?.count ?? 0;
}

/**
 * Dashboard business metrics + separate test activity.
 * Active subscriber definition matches checkout entitlement: active + future period end.
 */
export async function getDashboardData() {
  const db = getDatabase();
  const now = new Date();
  const users = db.collection('users');

  const [
    registeredAccounts,
    verifiedEmailAccounts,
    payingCustomers,
    activeSubscribers,
    testRegisteredAccounts,
    testActiveSubscribers,
  ] = await Promise.all([
    users.countDocuments(BUSINESS_USER_FILTER),
    users.countDocuments({
      ...BUSINESS_USER_FILTER,
      emailVerifiedAt: { $type: 'date' },
    }),
    countPayingCustomers(db),
    users.countDocuments({
      ...BUSINESS_USER_FILTER,
      subscriptionStatus: 'active',
      subscriptionCurrentPeriodEnd: { $gt: now },
    }),
    users.countDocuments({ isTest: true }),
    users.countDocuments({
      isTest: true,
      subscriptionStatus: 'active',
      subscriptionCurrentPeriodEnd: { $gt: now },
    }),
  ]);

  return {
    business: {
      registeredAccounts,
      verifiedEmailAccounts,
      payingCustomers,
      activeSubscribers,
    },
    testActivity: {
      registeredAccounts: testRegisteredAccounts,
      activeSubscribers: testActiveSubscribers,
    },
  };
}
