import { getDatabase } from '../../db/index.js';
import { logAdminAction } from './logAdminAction.js';

/**
 * Sets users.markedForReview and writes an audit log entry.
 */
export async function setCustomerMarkedForReview({
  targetUserId,
  adminUserId,
  markedForReview,
}) {
  const db = getDatabase();

  const existing = await db.collection('users').findOne(
    { _id: targetUserId },
    { projection: { markedForReview: 1 } }
  );
  if (!existing) {
    return { ok: false, error: 'Customer not found' };
  }

  const oldVal = !!existing.markedForReview;
  const newVal = !!markedForReview;

  if (oldVal === newVal) {
    return {
      ok: true,
      markedForReview: newVal,
      unchanged: true,
    };
  }

  await db.collection('users').updateOne(
    { _id: targetUserId },
    { $set: { markedForReview: newVal, updatedAt: new Date() } }
  );

  await logAdminAction({
    adminUserId,
    targetUserId,
    actionType: newVal ? 'customer_marked_for_review' : 'customer_unmarked_for_review',
    entityType: 'user',
    entityId: targetUserId,
    oldValue: { markedForReview: oldVal },
    newValue: { markedForReview: newVal },
    reason: null,
    metadata: null,
  });

  return { ok: true, markedForReview: newVal, unchanged: false };
}
