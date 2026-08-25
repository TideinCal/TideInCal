import { getDatabase } from '../../db/index.js';
import { logAdminAction } from './logAdminAction.js';
import { normalizeIsTest } from '../../attribution/index.js';

/**
 * Sets users.isTest, mirrors the flag onto existing local purchase records,
 * and writes an admin audit entry. Does not mutate Stripe objects.
 */
export async function setCustomerIsTest({
  targetUserId,
  adminUserId,
  isTest,
}) {
  if (typeof isTest !== 'boolean') {
    return { ok: false, error: 'isTest must be an explicit boolean' };
  }

  const db = getDatabase();

  const existing = await db.collection('users').findOne(
    { _id: targetUserId },
    { projection: { isTest: 1 } }
  );
  if (!existing) {
    return { ok: false, error: 'Customer not found' };
  }

  const oldVal = normalizeIsTest(existing.isTest);
  const newVal = isTest === true;

  if (oldVal === newVal) {
    return {
      ok: true,
      isTest: newVal,
      unchanged: true,
      purchasesUpdated: 0,
    };
  }

  await db.collection('users').updateOne(
    { _id: targetUserId },
    { $set: { isTest: newVal, updatedAt: new Date() } }
  );

  const purchaseResult = await db.collection('purchases').updateMany(
    { userId: targetUserId },
    { $set: { isTest: newVal, updatedAt: new Date() } }
  );

  await logAdminAction({
    adminUserId,
    targetUserId,
    actionType: newVal ? 'customer_marked_test' : 'customer_unmarked_test',
    entityType: 'user',
    entityId: targetUserId,
    oldValue: { isTest: oldVal },
    newValue: { isTest: newVal },
    reason: null,
    metadata: { purchasesUpdated: purchaseResult.modifiedCount },
  });

  return {
    ok: true,
    isTest: newVal,
    unchanged: false,
    purchasesUpdated: purchaseResult.modifiedCount,
  };
}
