#!/usr/bin/env node

import { connectToDatabase, getDatabase } from '../server/db/index.js';
import { ObjectId } from 'mongodb';
import Stripe from 'stripe';
import dotenv from 'dotenv';

dotenv.config();

const USER_ID = '69ab52b3dd2fd4f1e4aaca9d';

function normalizeStoredPeriodEnd(value) {
  if (!value) return null;
  const date = new Date(value);
  if (isNaN(date.getTime()) || date.getTime() < new Date('2000-01-01').getTime()) {
    return null;
  }
  return date;
}

function normalizeSubscriptionPeriodEnd(subscription) {
  if (!subscription?.current_period_end || typeof subscription.current_period_end !== 'number') return null;
  const periodEnd = new Date(subscription.current_period_end * 1000);
  if (isNaN(periodEnd.getTime()) || periodEnd.getTime() < new Date('2000-01-01').getTime()) return null;
  return periodEnd;
}

async function repair() {
  let client;
  try {
    console.log('Connecting to MongoDB...');
    const conn = await connectToDatabase();
    client = conn.client;
    const db = getDatabase();

    const userId = new ObjectId(USER_ID);

    const user = await db.collection('users').findOne({ _id: userId });
    if (!user) {
      console.error('User not found:', USER_ID);
      process.exit(1);
    }

    let subscriptionCurrentPeriodEnd = null;
    let subscriptionStatus = user.subscriptionStatus || 'active';
    let unlimitedSince = user.unlimitedSince ? new Date(user.unlimitedSince) : new Date();

    const subscriptionPurchase = await db.collection('purchases').findOne(
      { userId, product: 'subscription' },
      { sort: { createdAt: -1 } }
    );

    if (subscriptionPurchase) {
      const periodEnd = normalizeStoredPeriodEnd(subscriptionPurchase.subscriptionCurrentPeriodEnd);
      const oneYearFromPurchase = new Date(
        (subscriptionPurchase.createdAt?.getTime?.() ?? new Date(subscriptionPurchase.createdAt).getTime()) +
          365 * 24 * 60 * 60 * 1000
      );
      subscriptionCurrentPeriodEnd = periodEnd || oneYearFromPurchase;
      subscriptionStatus = subscriptionPurchase.subscriptionStatus || subscriptionStatus;
      if (!user.unlimitedSince && subscriptionPurchase.createdAt) {
        unlimitedSince = new Date(subscriptionPurchase.createdAt);
      }
    } else if (user.stripeSubscriptionId && process.env.STRIPE_SECRET_KEY) {
      console.log('No subscription purchase record; fetching from Stripe:', user.stripeSubscriptionId);
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      subscriptionCurrentPeriodEnd = normalizeSubscriptionPeriodEnd(subscription);
      subscriptionStatus = subscription.status;
      if (subscriptionCurrentPeriodEnd && !user.unlimitedSince) {
        unlimitedSince = new Date(Math.min(subscriptionCurrentPeriodEnd.getTime() - 365 * 24 * 60 * 60 * 1000, Date.now()));
      }
      if (!subscriptionCurrentPeriodEnd) {
        subscriptionCurrentPeriodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
        console.log('Stripe had no period end; using 1-year fallback.');
      }
    } else {
      const oneYearFallback = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      subscriptionCurrentPeriodEnd = normalizeStoredPeriodEnd(user.subscriptionCurrentPeriodEnd) || oneYearFallback;
      console.log('No purchase or Stripe subscription; using stored or 1-year fallback.');
    }

    const update = {
      $set: {
        subscriptionStatus,
        subscriptionCurrentPeriodEnd,
        unlimited: true,
        unlimitedSince,
        updatedAt: new Date(),
      },
    };

    const result = await db.collection('users').updateOne({ _id: userId }, update);

    if (result.modifiedCount === 0 && result.matchedCount === 1) {
      console.log('User already had correct subscription data (no change).');
    } else if (result.modifiedCount === 1) {
      console.log('Repaired user subscription:', {
        subscriptionStatus,
        subscriptionCurrentPeriodEnd: subscriptionCurrentPeriodEnd.toISOString(),
        unlimited: true,
        unlimitedSince: unlimitedSince.toISOString(),
      });
    } else {
      console.error('Update failed:', result);
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    console.error('Repair failed:', error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

repair();
