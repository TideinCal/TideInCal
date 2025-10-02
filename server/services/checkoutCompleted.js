// server/services/checkoutCompleted.js
import { getDatabase } from '../db/index.js';
import { sendDownloadReady } from '../auth/email.js';
import { generateICS } from '../ics/index.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function handleCheckoutCompleted(session) {
  console.log('[webhook] Processing checkout.session.completed for session:', session.id);
  
  const db = getDatabase();
  const { metadata = {} } = session;

  const {
    plan,
    userId,
    stationID,
    stationTitle,
    country,
  } = metadata;

  const { ObjectId } = await import('mongodb');

  // Best-effort email source (customer_email can be null on some modes)
  const customerEmail =
    session.customer_email ||
    session.customer_details?.email ||
    metadata.email ||
    null;

  console.log('[webhook] Customer email:', customerEmail || 'none');

  // 1) Persist Stripe customer id on user
  await db.collection('users').updateOne(
    { _id: new ObjectId(userId) },
    {
      $set: {
        stripeCustomerId: session.customer,
        updatedAt: new Date(),
      },
    }
  );
  console.log('[webhook] Updated user with Stripe customer ID');

  // 2) Record purchase
  await db.collection('purchases').insertOne({
    userId: new ObjectId(userId),
    stripeSessionId: session.id,
    stripePaymentIntentId: session.payment_intent ?? null,
    product: plan,
    metadata: {
      stationId: stationID,
      stationTitle,
      country,
      plan,
    },
    createdAt: new Date(),
  });
  console.log('[webhook] Created purchase record');

  // 3) Handle based on plan type
  if (plan === 'unlimited') {
    // Set unlimited entitlement
    await db.collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { 
        $set: { 
          unlimited: true, 
          unlimitedSince: new Date(),
          updatedAt: new Date() 
        } 
      }
    );
    console.log('[webhook] Set unlimited entitlement');
    return;
  }

  // Generate ICS content for single purchase
  console.log('[webhook] Generating ICS file for station:', stationTitle);
  const icsContent = await generateICS({
    id: stationID,
    title: stationTitle,
    country,
    includeMoon: false, // Default to false for now
  });

  // Save file
  const safeTitle = String(stationTitle || 'tide_station').replace(/[^a-zA-Z0-9]/g, '_');
  const fileName = `${safeTitle}_${Date.now()}.ics`;
  const filePath = path.join(__dirname, '../../tempICSFile', fileName);

  await fs.writeFile(filePath, icsContent, 'utf8');
  console.log('[webhook] Saved ICS file:', fileName);

  // TTL (365 days)
  const now = new Date();
  const retainUntil = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  const fileRecord = await db.collection('files').insertOne({
    userId: new ObjectId(userId),
    stationId: stationID,
    stationTitle,
    region: country,
    includesMoon: false, // Default to false for now
    fileName,
    storagePath: `tempICSFile/${fileName}`,
    createdAt: now,
    retainUntil,
    lastDownloadedAt: null,
  });
  console.log('[webhook] Created file record with TTL');

  // Update user entitlements - remove existing for same station, add new one
  await db.collection('users').updateOne(
    { _id: new ObjectId(userId) },
    {
      $pull: { 
        entitlements: { stationId: stationID } 
      },
      $push: { 
        entitlements: { 
          stationId: stationID,
          stationTitle,
          region: country,
          retainUntil 
        } 
      },
      $set: { updatedAt: now }
    }
  );
  console.log('[webhook] Updated user entitlements');

  // Email the download link (if we have an email and not in mock mode)
  if (customerEmail && process.env.MOCK_EMAILS !== 'true') {
    const downloadUrl = `${process.env.APP_URL}/api/files/${fileRecord.insertedId}/download`;
    await sendDownloadReady({
      to: customerEmail,
      stationTitle,
      link: downloadUrl,
    });
    console.log('[webhook] Sent download email to:', customerEmail);
  } else if (process.env.MOCK_EMAILS === 'true') {
    console.log('[webhook] Mock mode: skipping email send');
  }

  console.log('[webhook] Successfully processed checkout.session.completed');
}
