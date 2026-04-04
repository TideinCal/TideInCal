import { getDatabase } from '../../db/index.js';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Same “active subscriber” predicate as checkout / dashboard counts. */
function enrichForSearchList(user) {
  const now = new Date();
  const hasPeriodEnd =
    user.subscriptionCurrentPeriodEnd && new Date(user.subscriptionCurrentPeriodEnd) > now;
  return {
    ...user,
    subscriptionActive: user.subscriptionStatus === 'active' && !!hasPeriodEnd,
  };
}

/**
 * Search users by email, name, user id, Stripe customer id, purchase id, subscription id,
 * checkout session id, or payment intent id. Returns de-duplicated users (password excluded).
 */
export async function searchCustomers(rawQuery) {
  const db = getDatabase();
  const { ObjectId } = await import('mongodb');
  const q = (rawQuery || '').trim();
  if (!q) {
    return [];
  }

  const byId = new Map();

  function addUser(user) {
    if (!user || !user._id) return;
    const { passwordHash: _omit, ...rest } = user;
    byId.set(user._id.toString(), rest);
  }

  // MongoDB ObjectId (user or purchase)
  if (/^[a-fA-F0-9]{24}$/.test(q)) {
    try {
      const oid = new ObjectId(q);
      const user = await db.collection('users').findOne({ _id: oid });
      addUser(user);

      const purchase = await db.collection('purchases').findOne({ _id: oid });
      if (purchase?.userId) {
        const u = await db.collection('users').findOne({ _id: purchase.userId });
        addUser(u);
      }
    } catch {
      // invalid ObjectId
    }
  }

  if (q.startsWith('cus_')) {
    const users = await db
      .collection('users')
      .find({ stripeCustomerId: q })
      .limit(50)
      .toArray();
    for (const u of users) addUser(u);
  }

  if (q.startsWith('sub_')) {
    const fromUsers = await db
      .collection('users')
      .find({ stripeSubscriptionId: q })
      .limit(50)
      .toArray();
    for (const u of fromUsers) addUser(u);

    const purchases = await db
      .collection('purchases')
      .find({ stripeSubscriptionId: q })
      .limit(50)
      .toArray();
    for (const p of purchases) {
      if (p.userId) {
        const u = await db.collection('users').findOne({ _id: p.userId });
        addUser(u);
      }
    }
  }

  if (q.startsWith('cs_')) {
    const purchases = await db
      .collection('purchases')
      .find({ stripeSessionId: q })
      .limit(50)
      .toArray();
    for (const p of purchases) {
      if (p.userId) {
        const u = await db.collection('users').findOne({ _id: p.userId });
        addUser(u);
      }
    }
  }

  if (q.startsWith('pi_')) {
    const purchases = await db
      .collection('purchases')
      .find({ stripePaymentIntentId: q })
      .limit(50)
      .toArray();
    for (const p of purchases) {
      if (p.userId) {
        const u = await db.collection('users').findOne({ _id: p.userId });
        addUser(u);
      }
    }
  }

  // Text: email, firstName, lastName
  const safe = escapeRegex(q);
  const regex = new RegExp(safe, 'i');
  const textUsers = await db
    .collection('users')
    .find({
      $or: [{ email: regex }, { firstName: regex }, { lastName: regex }],
    })
    .project({ passwordHash: 0 })
    .limit(50)
    .toArray();

  for (const u of textUsers) addUser(u);

  return Array.from(byId.values()).map(enrichForSearchList);
}
