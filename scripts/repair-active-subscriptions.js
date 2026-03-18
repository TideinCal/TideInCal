#!/usr/bin/env node

/**
 * Repair active subscription users whose subscriptionCurrentPeriodEnd is missing,
 * invalid, or not in the future. Intended for staging/test maintenance.
 *
 * Strategy per user:
 * - If subscriptionStatus !== 'active' -> skip
 * - Try stored user.subscriptionCurrentPeriodEnd
 * - Otherwise, look at latest subscription purchase for that user
 * - If purchase has subscriptionCurrentPeriodEnd in the future, use that
 * - Else fall back to 1 year from purchase.createdAt (or from now if missing)
 * - Set:
 *   - subscriptionStatus: 'active'
 *   - subscriptionCurrentPeriodEnd: repaired future date
 *   - unlimited: true
 *   - unlimitedSince: existing or purchase.createdAt or now
 */

import { connectToDatabase, getDatabase } from '../server/db/index.js';
import { ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

function normalizeStoredPeriodEnd(value) {
  if (!value) return null;
  const date = new Date(value);
  if (isNaN(date.getTime()) || date.getTime() < new Date('2000-01-01').getTime()) {
    return null;
  }
  return date;
}

async function main() {
  console.log('Connecting to MongoDB...');
  await connectToDatabase();
  const db = getDatabase();

  const now = new Date();
  const users = await db
    .collection('users')
    .find({ subscriptionStatus: 'active' })
    .toArray();

  console.log(`Found ${users.length} users with subscriptionStatus === 'active'.`);

  let repairedCount = 0;
  for (const user of users) {
    const userId = user._id;
    const storedEnd = normalizeStoredPeriodEnd(user.subscriptionCurrentPeriodEnd);
    const hasFutureStored = storedEnd && storedEnd > now;

    if (hasFutureStored) {
      continue; // already good
    }

    console.log('\n--- Inspecting user ---');
    console.log(
      JSON.stringify(
        {
          _id: userId.toString(),
          email: user.email,
          subscriptionStatus: user.subscriptionStatus,
          subscriptionCurrentPeriodEnd: user.subscriptionCurrentPeriodEnd,
          stripeSubscriptionId: user.stripeSubscriptionId ?? null,
        },
        null,
        2,
      ),
    );

    // Try latest subscription purchase
    const subPurchase = await db.collection('purchases').findOne(
      {
        userId: new ObjectId(userId),
        product: 'subscription',
      },
      { sort: { createdAt: -1 } },
    );

    let repairedEnd = null;
    if (subPurchase) {
      const purchaseEnd = normalizeStoredPeriodEnd(subPurchase.subscriptionCurrentPeriodEnd);
      const purchaseCreated =
        subPurchase.createdAt || subPurchase.purchaseDate || new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      if (purchaseEnd && purchaseEnd > now) {
        repairedEnd = purchaseEnd;
      } else {
        repairedEnd = new Date(purchaseCreated.getTime() + 365 * 24 * 60 * 60 * 1000);
      }
    } else {
      // No purchase record: fall back to 1 year from now
      repairedEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    }

    const unlimitedSince =
      user.unlimitedSince ||
      (subPurchase && (subPurchase.createdAt || subPurchase.purchaseDate)) ||
      now;

    const update = {
      $set: {
        subscriptionStatus: 'active',
        subscriptionCurrentPeriodEnd: repairedEnd,
        unlimited: true,
        unlimitedSince,
        updatedAt: new Date(),
      },
    };

    const res = await db.collection('users').updateOne({ _id: userId }, update);
    if (res.modifiedCount === 1) {
      repairedCount += 1;
      console.log('Repaired user subscription:', {
        _id: userId.toString(),
        subscriptionStatus: 'active',
        subscriptionCurrentPeriodEnd: repairedEnd.toISOString(),
        unlimited: true,
        unlimitedSince: unlimitedSince.toISOString(),
      });
    } else {
      console.log('No changes applied for user (maybe already correct).');
    }
  }

  console.log(`\nRepaired ${repairedCount} active subscription user(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Repair failed:', err);
  process.exit(1);
});

