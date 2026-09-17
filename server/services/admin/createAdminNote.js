import { getDatabase } from '../../db/index.js';
import { logAdminAction } from './logAdminAction.js';

const MAX_NOTE_LENGTH = 8000;

/**
 * @param {object} opts
 * @param {import('mongodb').ObjectId} opts.targetUserId
 * @param {import('mongodb').ObjectId} opts.adminUserId
 * @param {string} opts.noteText
 */
export async function createAdminNote({ targetUserId, adminUserId, noteText }) {
  const db = getDatabase();
  const now = new Date();

  const doc = {
    userId: targetUserId,
    note: noteText,
    createdBy: adminUserId,
    updatedBy: adminUserId,
    createdAt: now,
    updatedAt: now,
  };

  const result = await db.collection('admin_notes').insertOne(doc);
  const note = { ...doc, _id: result.insertedId };

  await logAdminAction({
    adminUserId,
    targetUserId,
    actionType: 'note_created',
    entityType: 'admin_note',
    entityId: result.insertedId,
    newValue: { notePreview: noteText.slice(0, 200) },
    reason: null,
    metadata: null,
  });

  return { note };
}

export { MAX_NOTE_LENGTH };
