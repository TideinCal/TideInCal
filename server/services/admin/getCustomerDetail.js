import { getDatabase } from '../../db/index.js';

async function loadAdminProfiles(db, ObjectId, idStrings) {
  const unique = [...new Set(idStrings.filter(Boolean))];
  if (unique.length === 0) return {};
  const ids = unique.map((s) => new ObjectId(s));
  const admins = await db
    .collection('users')
    .find({ _id: { $in: ids } })
    .project({ email: 1, firstName: 1, lastName: 1 })
    .toArray();
  return Object.fromEntries(
    admins.map((u) => [
      u._id.toString(),
      { email: u.email, firstName: u.firstName, lastName: u.lastName },
    ])
  );
}

/**
 * Customer detail: user (no password), purchases, subscription summary, notes, audit log.
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

  const [notes, auditEntries] = await Promise.all([
    db
      .collection('admin_notes')
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray(),
    db
      .collection('admin_audit_logs')
      .find({ targetUserId: userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray(),
  ]);

  const adminIdStrings = [];
  for (const n of notes) {
    if (n.createdBy) adminIdStrings.push(n.createdBy.toString());
    if (n.updatedBy) adminIdStrings.push(n.updatedBy.toString());
  }
  for (const a of auditEntries) {
    if (a.adminUserId) adminIdStrings.push(a.adminUserId.toString());
  }
  const adminById = await loadAdminProfiles(db, ObjectId, adminIdStrings);

  const notesOut = notes.map((n) => ({
    ...n,
    createdByProfile: adminById[n.createdBy?.toString()] || null,
    updatedByProfile: adminById[n.updatedBy?.toString()] || null,
  }));

  const auditOut = auditEntries.map((a) => ({
    ...a,
    adminProfile: adminById[a.adminUserId?.toString()] || null,
  }));

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

  const latestSubPurchase = purchases.find(
    (p) => p.product === 'subscription' && p.stripeSubscriptionId
  );

  return {
    user,
    purchases,
    subscriptionSummary,
    latestSubscriptionPurchase: latestSubPurchase || null,
    notes: notesOut,
    auditLog: auditOut,
  };
}
