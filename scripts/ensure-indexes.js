#!/usr/bin/env node

import { connectToDatabase } from '../server/db/index.js';
import dotenv from 'dotenv';

dotenv.config();

async function ensureIndexes() {
  try {
    console.log('Connecting to MongoDB...');
    const { db } = await connectToDatabase();
    
    console.log('Ensuring indexes exist...');
    
    // Users collection indexes
    await db.collection('users').createIndex(
      { email: 1 },
      { unique: true, name: 'email_unique' }
    );
    console.log('✓ users.email unique index');

    await db.collection('users').createIndex(
      { normalizedEmail: 1 },
      { unique: true, sparse: true, name: 'users_normalizedEmail_unique' }
    );
    console.log('✓ users.normalizedEmail unique (sparse) index');
    
    // Files collection indexes
    await db.collection('files').createIndex(
      { retainUntil: 1 },
      { expireAfterSeconds: 0, name: 'retainUntil_ttl' }
    );
    console.log('✓ files.retainUntil TTL index');
    
    await db.collection('files').createIndex(
      { userId: 1 },
      { name: 'userId_index' }
    );
    console.log('✓ files.userId index');
    
    // Purchases collection indexes
    await db.collection('purchases').createIndex(
      { userId: 1 },
      { name: 'userId_index' }
    );
    console.log('✓ purchases.userId index');

    await db.collection('purchases').createIndex(
      { userId: 1, createdAt: 1, isTest: 1, fullyRefundedAt: 1 },
      { name: 'purchases_new_customer_lookup' }
    );
    console.log('✓ purchases new-customer lookup index');
    
    await db.collection('purchases').createIndex(
      { stripeSessionId: 1 },
      { unique: true, name: 'stripeSessionId_unique' }
    );
    console.log('✓ purchases.stripeSessionId unique index');

    await db.collection('admin_notes').createIndex(
      { userId: 1, createdAt: -1 },
      { name: 'admin_notes_userId_createdAt' }
    );
    console.log('✓ admin_notes.userId + createdAt index');

    await db.collection('admin_audit_logs').createIndex(
      { targetUserId: 1, createdAt: -1 },
      { name: 'admin_audit_target_createdAt' }
    );
    console.log('✓ admin_audit_logs.targetUserId + createdAt index');

    await db.collection('webhook_events').createIndex(
      { eventId: 1 },
      { unique: true, name: 'webhook_events_eventId_unique' }
    );
    console.log('✓ webhook_events.eventId unique index');

    await db.collection('funnel_events').createIndex(
      { eventName: 1, dedupeKey: 1 },
      { unique: true, name: 'funnel_events_event_dedupe_unique' }
    );
    console.log('✓ funnel event deterministic dedupe index');

    await db.collection('funnel_events').createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'funnel_events_anonymous_ttl' }
    );
    console.log('✓ anonymous funnel event 90-day TTL index');

    await db.collection('funnel_events').createIndex(
      { campaign: 1, serverTimestamp: 1, eventName: 1, isTest: 1 },
      { name: 'funnel_events_campaign_report' }
    );
    console.log('✓ funnel campaign report index');

    await db.collection('purchases').createIndex(
      { stripePaymentIntentId: 1 },
      { sparse: true, name: 'purchases_stripePaymentIntentId' }
    );
    console.log('✓ purchases.stripePaymentIntentId index');

    console.log('All indexes ensured successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Failed to ensure indexes:', error);
    process.exit(1);
  }
}

ensureIndexes();
