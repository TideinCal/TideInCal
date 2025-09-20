import express from 'express';
import Stripe from 'stripe';
import { getDatabase } from '../db/index.js';
import { Resend } from 'resend';
import { generateICS } from '../ics/index.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// POST /api/stripe/webhook
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      await handleCheckoutCompleted(session);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

async function handleCheckoutCompleted(session) {
  const db = getDatabase();
  const { metadata } = session;
  
  // Extract metadata
  const {
    userId,
    stationID,
    stationTitle,
    country,
    includeMoon,
    unlimited
  } = metadata;

  const includeMoonBool = includeMoon === 'true';
  const unlimitedBool = unlimited === 'true';

  try {
    // Update user with Stripe customer ID
    await db.collection('users').updateOne(
      { _id: userId },
      { 
        $set: { 
          stripeCustomerId: session.customer,
          updatedAt: new Date()
        }
      }
    );

    // Create purchase record
    await db.collection('purchases').insertOne({
      userId,
      stripeSessionId: session.id,
      stripePaymentIntentId: session.payment_intent,
      product: unlimitedBool ? 'unlimited' : (includeMoonBool ? 'lunar-addon' : 'single'),
      metadata: {
        stationId: stationID,
        stationTitle,
        country,
        includeMoon: includeMoonBool,
        unlimited: unlimitedBool
      },
      createdAt: new Date()
    });

    if (unlimitedBool) {
      // Set unlimited entitlement
      await db.collection('users').updateOne(
        { _id: userId },
        { 
          $set: { 
            unlimited: true,
            updatedAt: new Date()
          }
        }
      );
    } else {
      // Generate ICS file for single download
      const stationData = {
        id: stationID,
        title: stationTitle,
        country,
        includeMoon: includeMoonBool
      };

      // Generate ICS content
      const icsContent = await generateICS(stationData);
      
      // Save file to tempICSFile directory
      const fileName = `${stationTitle.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.ics`;
      const filePath = path.join(__dirname, '../../tempICSFile', fileName);
      
      await fs.writeFile(filePath, icsContent, 'utf8');

      // Create file record with 365-day retention
      const now = new Date();
      const retainUntil = new Date(now.getTime() + (365 * 24 * 60 * 60 * 1000)); // 365 days
      
      const fileRecord = await db.collection('files').insertOne({
        userId,
        stationId: stationID,
        stationTitle,
        region: country,
        includesMoon: includeMoonBool,
        storagePath: `tempICSFile/${fileName}`,
        createdAt: now,
        retainUntil,
        lastDownloadedAt: null
      });

      // Send email with download link
      const downloadUrl = `${process.env.APP_URL}/api/files/${fileRecord.insertedId}/download`;
      
      await resend.emails.send({
        from: 'TideInCal <noreply@tideincal.com>',
        to: session.customer_email,
        subject: 'Your tide calendar is ready!',
        html: `
          <h2>Your tide calendar is ready!</h2>
          <p>Thank you for your purchase. Your personalized tide calendar for <strong>${stationTitle}</strong> has been generated and is ready for download.</p>
          <p><a href="${downloadUrl}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">Download Calendar File</a></p>
          <p><small>This file will be available for download for 365 days.</small></p>
        `
      });

      console.log(`File generated and email sent for session ${session.id}`);
    }
  } catch (error) {
    console.error('Error processing checkout completion:', error);
    throw error;
  }
}

export default router;
