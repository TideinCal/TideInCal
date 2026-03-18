#!/usr/bin/env node

/**
 * Normalize stripeCustomerId fields on users and purchases:
 * - If stripeCustomerId is an object, replace with its .id or .customer
 * - If it's a string not starting with 'cus_', leave as-is (checkout.js will ignore it)
 */

import { connectToDatabase, getDatabase } from '../server/db/index.js';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('Connecting to MongoDB...');
  await connectToDatabase();
  const db = getDatabase();

  let fixedUsers = 0;
  let fixedPurchases = 0;

  // Users
  const users = await db
    .collection('users')
    .find({ stripeCustomerId: { $exists: true } })
    .toArray();

  for (const user of users) {
    const value = user.stripeCustomerId;
    if (value && typeof value === 'object') {
      const candidate = value.id || value.customer || null;
      const update = {
        $set: {
          stripeCustomerId: candidate,
          updatedAt: new Date(),
        },
      };
      await db.collection('users').updateOne({ _id: user._id }, update);
      fixedUsers += 1;
      console.log('Normalized user.stripeCustomerId:', {
        _id: user._id.toString(),
        before: value,
        after: candidate,
      });
    }
  }

  // Purchases
  const purchases = await db
    .collection('purchases')
    .find({ stripeCustomerId: { $exists: true } })
    .toArray();

  for (const p of purchases) {
    const value = p.stripeCustomerId;
    if (value && typeof value === 'object') {
      const candidate = value.id || value.customer || null;
      const update = {
        $set: {
          stripeCustomerId: candidate,
          updatedAt: new Date(),
        },
      };
      await db.collection('purchases').updateOne({ _id: p._id }, update);
      fixedPurchases += 1;
      console.log('Normalized purchase.stripeCustomerId:', {
        _id: p._id.toString(),
        before: value,
        after: candidate,
      });
    }
  }

  console.log(`\nNormalized stripeCustomerId on ${fixedUsers} user(s) and ${fixedPurchases} purchase(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Normalization failed:', err);
  process.exit(1);
});

