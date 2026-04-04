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

    console.log('All indexes ensured successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Failed to ensure indexes:', error);
    process.exit(1);
  }
}

ensureIndexes();
