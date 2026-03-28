import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

let client;
let db;
let databaseName = 'tideincal';

function getDatabaseNameFromUri(uri) {
  if (!uri || typeof uri !== 'string') return 'tideincal';
  try {
    const url = new URL(uri.replace(/^mongodb\+srv/, 'https'));
    const name = (url.pathname || '').replace(/^\//, '').split('?')[0].trim();
    return name || 'tideincal';
  } catch {
    return 'tideincal';
  }
}

export async function connectToDatabase() {
  if (db) {
    return { client, db };
  }

  try {
    databaseName = getDatabaseNameFromUri(process.env.MONGO_URI);
    client = new MongoClient(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 30000,
      maxPoolSize: 10,
      retryWrites: true,
      retryReads: true,
      w: 'majority',
      tls: true,
      tlsAllowInvalidCertificates: false,
      tlsAllowInvalidHostnames: false
    });
    await client.connect();
    db = client.db(databaseName);
    
    // Create TTL index on files.retainUntil
    await db.collection('files').createIndex(
      { retainUntil: 1 },
      { expireAfterSeconds: 0 }
    );
    
    // Create unique index on users.email
    await db.collection('users').createIndex(
      { email: 1 },
      { unique: true }
    );
    
    // Create index on files.userId for efficient queries
    await db.collection('files').createIndex({ userId: 1 });
    
    // Create index on purchases.userId
    await db.collection('purchases').createIndex({ userId: 1 });
    
    console.log('Connected to MongoDB (database: %s) and created indexes', databaseName);
    return { client, db };
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    throw error;
  }
}

export function getDatabase() {
  if (!db) {
    throw new Error('Database not connected. Call connectToDatabase() first.');
  }
  return db;
}

export function getClient() {
  if (!client) {
    throw new Error('Client not connected. Call connectToDatabase() first.');
  }
  return client;
}

/** Database name in use (for debugging). Only set after connectToDatabase(). */
export function getDatabaseName() {
  return databaseName;
}
