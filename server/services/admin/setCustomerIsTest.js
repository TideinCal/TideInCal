import { getDatabase } from '../../db/index.js';
import { logAdminAction } from './logAdminAction.js';
import { normalizeIsTest } from '../../attribution/index.js';

/**
 * Sets users.isTest, mirrors the flag onto existing local purchase records,
 * and writes an admin audit entry. Does not mutate Stripe objects.
 *
 * Retry-safe: always reconciles local purchases and always writes an audit
 * entry (including verified no-ops), so a prior partial failure that updated
 * data but failed the audit insert can be repaired on repeat.
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
  const userFlagChanged = oldVal !== newVal;

  // Always set the user flag (idempotent) so retries converge
  await db.collection('users').updateOne(
    { _id: targetUserId },
    { $set: { isTest: newVal, updatedAt: new Date() } }
  );

  // Reconcile purchases that are not already at the desired flag
  const purchaseResult = await db.collection('purchases').updateMany(
    {
      userId: targetUserId,
      isTest: { $ne: newVal },
    },
    { $set: { isTest: newVal, updatedAt: new Date() } }
  );

  const purchasesUpdated = purchaseResult.modifiedCount;
  const repaired = !userFlagChanged && purchasesUpdated > 0;
  const verified = !userFlagChanged && purchasesUpdated === 0;

  let actionType;
  let reason = null;
  if (verified) {
    actionType = 'customer_test_flag_verified';
    reason =
      'Explicit repeat confirmed user and purchase isTest flags already matched';
  } else if (repaired) {
    actionType = 'customer_test_flag_reconciled';
    reason = 'Retry reconciled local purchase isTest flags';
  } else {
    actionType = newVal ? 'customer_marked_test' : 'customer_unmarked_test';
  }

  await logAdminAction({
    adminUserId,
    targetUserId,
    actionType,
    entityType: 'user',
    entityId: targetUserId,
    oldValue: { isTest: oldVal },
    newValue: { isTest: newVal },
    reason,
    metadata: {
      purchasesUpdated,
      repaired,
      userFlagChanged,
      verified,
    },
  });

  return {
    ok: true,
    isTest: newVal,
    unchanged: verified,
    purchasesUpdated,
    repaired,
    verified,
  };
}
