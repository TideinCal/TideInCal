#!/usr/bin/env node

// Backfill the `normalizedEmail` field on existing user documents so that
// the unique index introduced in server/db/index.js can be enforced.
//
// Idempotent: safe to run repeatedly. Logs any normalization collisions
// (two existing accounts that resolve to the same canonical inbox) without
// dying — those need manual review.
//
// Usage: node scripts/backfillNormalizedEmail.js

import { connectToDatabase, getClient } from '../server/db/index.js';
import { normalizeEmail } from '../server/auth/normalizeEmail.js';
import dotenv from 'dotenv';

dotenv.config();

async function backfill() {
  console.log('Connecting to MongoDB...');
  const { db } = await connectToDatabase();
  const users = db.collection('users');

  const cursor = users.find(
    { normalizedEmail: { $exists: false } },
    { projection: { _id: 1, email: 1, createdAt: 1 } }
  );

  let processed = 0;
  let updated = 0;
  let collisions = 0;
  const collisionGroups = new Map();

  while (await cursor.hasNext()) {
    const user = await cursor.next();
    processed += 1;

    const normalized = normalizeEmail(user.email);
    if (!normalized) {
      console.warn(`[skip] user ${user._id} has unparseable email: ${user.email}`);
      continue;
    }

    try {
      await users.updateOne(
        { _id: user._id },
        { $set: { normalizedEmail: normalized } }
      );
      updated += 1;
    } catch (err) {
      if (err?.code === 11000) {
        collisions += 1;
        const existing = collisionGroups.get(normalized) || [];
        existing.push({ _id: user._id, email: user.email, createdAt: user.createdAt });
        collisionGroups.set(normalized, existing);
      } else {
        console.error(`[error] user ${user._id}:`, err.message);
      }
    }
  }

  console.log('');
  console.log(`Processed:    ${processed}`);
  console.log(`Updated:      ${updated}`);
  console.log(`Collisions:   ${collisions}`);

  if (collisionGroups.size > 0) {
    console.log('');
    console.log('Collision details (these need manual review — multiple accounts');
    console.log('resolve to the same canonical inbox):');
    for (const [normalized, group] of collisionGroups.entries()) {
      console.log(`  ${normalized}:`);
      for (const entry of group) {
        console.log(`    - _id=${entry._id}  email=${entry.email}  createdAt=${entry.createdAt}`);
      }
    }
  }

  const client = getClient();
  await client.close();
  process.exit(collisions > 0 ? 2 : 0);
}

backfill().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
