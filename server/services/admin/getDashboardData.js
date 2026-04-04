import { getDatabase } from '../../db/index.js';

/**
 * Dashboard counts derived from existing users collection (no subscriptions collection).
 * Active subscriber definition matches checkout gate: active status + period end in the future.
 */
export async function getDashboardData() {
  const db = getDatabase();
  const now = new Date();

  const [totalUsers, activeSubscribers] = await Promise.all([
    db.collection('users').countDocuments({}),
    db.collection('users').countDocuments({
      subscriptionStatus: 'active',
      subscriptionCurrentPeriodEnd: { $gt: now },
    }),
  ]);

  return {
    totalUsers,
    activeSubscribers,
  };
}
