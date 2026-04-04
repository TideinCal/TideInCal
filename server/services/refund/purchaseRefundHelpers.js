import { getDatabase } from '../../db/index.js';

/**
 * True if this user has a subscription purchase row for this Stripe subscription id with a full refund recorded.
 */
export async function hasProSubscriptionFullyRefundedPurchase(userId, stripeSubscriptionId) {
  if (!stripeSubscriptionId) return false;
  const db = getDatabase();
  const { ObjectId } = await import('mongodb');
  const purchase = await db.collection('purchases').findOne({
    userId: new ObjectId(userId),
    product: 'subscription',
    stripeSubscriptionId,
    fullyRefundedAt: { $exists: true, $ne: null },
  });
  return !!purchase;
}

/** Mongo filter: purchase does not have a full refund recorded. */
export const purchaseNotFullyRefundedFilter = {
  $or: [{ fullyRefundedAt: { $exists: false } }, { fullyRefundedAt: null }],
};
