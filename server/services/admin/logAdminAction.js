import { getDatabase } from '../../db/index.js';

/**
 * Append-only admin audit log. Call after every successful admin write action.
 * @param {object} params
 * @param {import('mongodb').ObjectId} params.adminUserId
 * @param {import('mongodb').ObjectId} params.targetUserId
 * @param {string} params.actionType
 * @param {string} [params.entityType]
 * @param {import('mongodb').ObjectId|string|null} [params.entityId]
 * @param {unknown} [params.oldValue]
 * @param {unknown} [params.newValue]
 * @param {string|null} [params.reason]
 * @param {unknown} [params.metadata]
 */
export async function logAdminAction({
  adminUserId,
  targetUserId,
  actionType,
  entityType = 'user',
  entityId = null,
  oldValue = null,
  newValue = null,
  reason = null,
  metadata = null,
}) {
  const db = getDatabase();
  const now = new Date();
  await db.collection('admin_audit_logs').insertOne({
    adminUserId,
    targetUserId,
    actionType,
    entityType,
    entityId,
    oldValue: oldValue === undefined ? null : oldValue,
    newValue: newValue === undefined ? null : newValue,
    reason,
    metadata,
    createdAt: now,
  });
}
