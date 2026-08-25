import { getDatabase } from '../../db/index.js';

/** Business totals exclude explicitly marked test accounts; missing isTest counts as business. */
export const BUSINESS_USER_FILTER = { isTest: { $ne: true } };

/**
 * Dashboard counts derived from existing users collection (no subscriptions collection).
 * Active subscriber definition matches checkout gate: active status + period end in the future.
 * Test accounts are excluded from business totals and reported separately when useful.
 */
export async function getDashboardData() {
  const db = getDatabase();
  const now = new Date();
  const users = db.collection('users');

  const [
    totalUsers,
    activeSubscribers,
    testUsers,
    testActiveSubscribers,
  ] = await Promise.all([
    users.countDocuments(BUSINESS_USER_FILTER),
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
    totalUsers,
    activeSubscribers,
    testActivity: {
      totalUsers: testUsers,
      activeSubscribers: testActiveSubscribers,
    },
  };
}
