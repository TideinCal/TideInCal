import { getDatabase } from '../../db/index.js';

/**
 * Customer detail: user (no password), purchases for user, subscription summary from user + purchases.
 */
export async function getCustomerDetail(userIdString) {
  const db = getDatabase();
  const { ObjectId } = await import('mongodb');

  let userId;
  try {
    userId = new ObjectId(userIdString);
  } catch {
    return null;
  }

  const user = await db.collection('users').findOne(
    { _id: userId },
    { projection: { passwordHash: 0 } }
  );
  if (!user) {
    return null;
  }

  const purchases = await db
    .collection('purchases')
    .find({ userId })
    .sort({ createdAt: -1 })
    .project({ userId: 0 })
    .toArray();

  const now = new Date();
  const hasPeriodEnd =
    user.subscriptionCurrentPeriodEnd && new Date(user.subscriptionCurrentPeriodEnd) > now;
  const subscriptionActive =
    user.subscriptionStatus === 'active' && !!hasPeriodEnd;

  const subscriptionSummary = {
    stripeSubscriptionId: user.stripeSubscriptionId || null,
    stripeCustomerId: user.stripeCustomerId || null,
    subscriptionStatus: user.subscriptionStatus || null,
    subscriptionCurrentPeriodEnd: user.subscriptionCurrentPeriodEnd || null,
    unlimited: !!user.unlimited,
    subscriptionActive,
  };

  const latestSubPurchase = purchases.find((p) => p.product === 'subscription' && p.stripeSubscriptionId);

  return {
    user,
    purchases,
    subscriptionSummary,
    latestSubscriptionPurchase: latestSubPurchase || null,
  };
}
