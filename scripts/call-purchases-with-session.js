#!/usr/bin/env node

/**
 * Calls GET /api/auth/me/purchases on localhost using an existing Mongo-backed session.
 *
 * How it works:
 * - Reads the latest session doc from tideincal.sessions (connect-mongo)
 * - Builds a valid signed `connect.sid` cookie value using SESSION_SECRET
 * - Calls the endpoint and prints the JSON response
 */

import dotenv from 'dotenv';
import { connectToDatabase, getClient } from '../server/db/index.js';
import signature from 'cookie-signature';

dotenv.config();

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function pickSessionId(doc) {
  // connect-mongo default schema uses _id as session id
  if (doc && doc._id) return String(doc._id);
  return null;
}

async function main() {
  // In local dev, server.js falls back to a hardcoded secret if SESSION_SECRET is unset.
  // Try env secret first, then the fallback so this script can call the local API reliably.
  const secretsToTry = [];
  if (process.env.SESSION_SECRET) secretsToTry.push(process.env.SESSION_SECRET);
  secretsToTry.push('fallback-secret-change-in-production');

  await connectToDatabase();
  const client = getClient();

  const sessionsCol = client.db('tideincal').collection('sessions');
  const latest = await sessionsCol.find({}).sort({ expires: -1 }).limit(1).toArray();
  const sessionDoc = latest[0];
  if (!sessionDoc) {
    console.error('No sessions found in tideincal.sessions.');
    process.exit(1);
  }

  const sid = pickSessionId(sessionDoc);
  if (!sid) {
    console.error('Could not determine session id from session document:', sessionDoc);
    process.exit(1);
  }

  for (const secret of secretsToTry) {
    // cookie-signature.sign(sid, secret) returns: `${sid}.${signature}`
    // express-session cookie value is: `s:${sid}.${signature}` (then URL-encoded in Set-Cookie)
    const signed = 's:' + signature.sign(sid, secret);
    const cookie = `connect.sid=${encodeURIComponent(signed)}`;

  const res = await fetch(`${BASE_URL}/api/auth/me/entitlements`, {
      headers: { Cookie: cookie },
      redirect: 'manual'
    });

    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) {
      json = null;
    }

    console.log('Tried secret:', secret === 'fallback-secret-change-in-production' ? '(fallback)' : '(env)');
    console.log('HTTP', res.status);

    if (json) {
      console.log(JSON.stringify(json, null, 2));
    } else {
      console.log(text.slice(0, 500));
    }

    if (res.ok) {
      process.exit(0);
      return;
    }
  }

  process.exit(1);
}

main().catch((e) => {
  console.error('Request failed:', e?.message ?? e);
  process.exit(1);
});

