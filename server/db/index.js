import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

let client;
let db;

export async function connectToDatabase() {
  if (db) {
    return { client, db };
  }

  try {
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
    db = client.db('tideincal');
    
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
    
    console.log('Connected to MongoDB and created indexes');
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
