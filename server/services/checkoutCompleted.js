// server/services/checkoutCompleted.js
import { getDatabase } from '../db/index.js';
import { sendDownloadReady } from '../auth/email.js';
import Stripe from 'stripe';

/**
 * Creates a purchase record from a Stripe checkout session
 * Idempotent - can be called multiple times safely
 * @param {Object} session - Stripe checkout session object
 * @param {Object} db - MongoDB database instance
 * @param {Object} ObjectId - MongoDB ObjectId constructor
 * @returns {Object|null} - Created or existing purchase record, or null on error
 */
export async function createPurchaseFromSession(session, db, ObjectId) {
  const { metadata = {} } = session;
  
  // Log metadata for visibility
  console.log('[checkoutCompleted] Metadata received:', JSON.stringify(metadata));

  const {
    plan,
    userId,
    stationID,
    stationTitle,
    country,
  } = metadata;

  if (!userId) {
    console.error('[checkoutCompleted] Missing userId in session metadata');
    return null;
  }

  // Check if purchase already exists (idempotent)
  const existingPurchase = await db.collection('purchases').findOne({
    stripeSessionId: session.id
  });

  if (existingPurchase) {
    console.log('[checkoutCompleted] Purchase already exists:', existingPurchase._id.toString());
    return existingPurchase;
  }

  // Best-effort email source
  const customerEmail =
    session.customer_email ||
    session.customer_details?.email ||
    metadata.email ||
    null;

  // 1) Update user with Stripe customer id and billing info
  const updateData = {
    stripeCustomerId: session.customer,
    updatedAt: new Date(),
  };

  if (session.customer_details) {
    if (session.customer_details.name) {
      updateData.billingName = session.customer_details.name;
    }
    if (session.customer_details.address) {
      updateData.billingAddress = session.customer_details.address;
    }
  }

  try {
    await db.collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { $set: updateData }
    );
  } catch (error) {
    console.error('[checkoutCompleted] Error updating user:', error);
    // Continue even if user update fails
  }

  // 2) Handle based on plan type or mode
  if (plan === 'unlimited' || plan === 'subscription' || session.mode === 'subscription') {
    // Subscription purchase
    const subscriptionId = typeof session.subscription === 'string' 
      ? session.subscription 
      : session.subscription?.id;
    
    if (!subscriptionId) {
      console.error('[checkoutCompleted] Subscription ID missing from session');
      return null;
    }

    // Use expanded subscription if available, otherwise fetch it
    let subscription;
    if (typeof session.subscription === 'object' && session.subscription !== null) {
      subscription = session.subscription;
      console.log('[checkoutCompleted] Using expanded subscription from session');
    } else {
      console.log('[checkoutCompleted] Retrieving subscription from Stripe:', subscriptionId);
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      try {
        subscription = await stripe.subscriptions.retrieve(subscriptionId);
      } catch (error) {
        console.error('[checkoutCompleted] Error retrieving subscription from Stripe:', error.message);
        return null;
      }
    }
    
    // Validate and convert subscription period end
    let currentPeriodEnd = null;
    if (subscription.current_period_end && typeof subscription.current_period_end === 'number') {
      currentPeriodEnd = new Date(subscription.current_period_end * 1000);
      // Validate it's a reasonable date (not epoch start)
      if (currentPeriodEnd.getTime() < new Date('2000-01-01').getTime()) {
        console.error('[checkoutCompleted] Invalid current_period_end from Stripe:', subscription.current_period_end);
        currentPeriodEnd = null;
      }
    }
    
    if (!currentPeriodEnd && subscription.status === 'active') {
      console.warn('[checkoutCompleted] Missing valid current_period_end for active subscription, calculating 1 year from now');
      // Default to 1 year from now for active subscriptions without period end
      currentPeriodEnd = new Date();
      currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
    }

    // Update user with subscription info
    try {
      const updateData = {
        stripeSubscriptionId: subscriptionId,
        subscriptionStatus: subscription.status,
        unlimited: subscription.status === 'active',
        unlimitedSince: new Date(),
        updatedAt: new Date()
      };
      
      if (currentPeriodEnd) {
        updateData.subscriptionCurrentPeriodEnd = currentPeriodEnd;
      }
      
      await db.collection('users').updateOne(
        { _id: new ObjectId(userId) },
        { $set: updateData }
      );
      
      console.log('[checkoutCompleted] Updated user subscription:', {
        subscriptionId,
        status: subscription.status,
        periodEnd: currentPeriodEnd
      });
    } catch (error) {
      console.error('[checkoutCompleted] Error updating user subscription:', error);
    }

    // Record subscription purchase
    const purchaseData = {
      userId: new ObjectId(userId),
      stripeSessionId: session.id,
      stripeSubscriptionId: subscriptionId,
      stripePaymentIntentId: session.payment_intent ?? null,
      product: 'subscription',
      amount: session.amount_total,
      currency: session.currency,
      customerEmail: customerEmail,
      subscriptionStatus: subscription.status,
      createdAt: new Date(),
    };
    
    // Only add period end if we have a valid date
    if (currentPeriodEnd) {
      purchaseData.subscriptionCurrentPeriodEnd = currentPeriodEnd;
    }

    if (session.customer_details) {
      purchaseData.customerDetails = {
        name: session.customer_details.name,
        address: session.customer_details.address,
      };
    }

    try {
      const result = await db.collection('purchases').insertOne(purchaseData);
      return await db.collection('purchases').findOne({ _id: result.insertedId });
    } catch (error) {
      console.error('[checkoutCompleted] Error inserting subscription purchase:', error);
      return null;
    }
  }

  // 3) Handle one-time purchase (single station)
  const now = new Date();
  const purchaseDate = now;
  const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 365 days

  const purchaseData = {
    userId: new ObjectId(userId),
    stripeSessionId: session.id,
    stripePaymentIntentId: session.payment_intent ?? null,
    product: 'single',
    amount: session.amount_total,
    currency: session.currency,
    customerEmail: customerEmail,
    purchaseDate: purchaseDate,
    expiresAt: expiresAt,
    regenerationParams: {
      stationId: stationID,
      stationTitle,
      country,
      includeMoon: false,
      userTimezone: 'UTC',
      feet: false,
    },
    createdAt: now,
  };

  if (session.customer_details) {
    purchaseData.customerDetails = {
      name: session.customer_details.name,
      address: session.customer_details.address,
    };
  }

  try {
    const result = await db.collection('purchases').insertOne(purchaseData);
    return await db.collection('purchases').findOne({ _id: result.insertedId });
  } catch (error) {
    console.error('[checkoutCompleted] Error inserting one-time purchase:', error);
    return null;
  }
}

/**
 * Handles checkout.session.completed webhook event
 * Stores purchase/subscription data and regeneration parameters
 * Does NOT generate or store ICS files (generated on-demand)
 */
export async function handleCheckoutCompleted(session) {
  console.log('[webhook] Processing checkout.session.completed for session:', session.id);
  
  const db = getDatabase();
  const { ObjectId } = await import('mongodb');

  try {
    // Use the shared purchase creation function (idempotent)
    const purchase = await createPurchaseFromSession(session, db, ObjectId);
    
    if (!purchase) {
      console.error('[webhook] Failed to create purchase record for session:', session.id);
      throw new Error('Failed to create purchase record');
    }

    console.log('[webhook] Successfully created/verified purchase record:', purchase._id.toString());

    // Send email notification for one-time purchases
    const { metadata = {} } = session;
    const { stationTitle } = metadata;
    const customerEmail =
      session.customer_email ||
      session.customer_details?.email ||
      metadata.email ||
      null;

    if (purchase.product === 'single' && customerEmail && process.env.MOCK_EMAILS !== 'true') {
      const accountUrl = `${process.env.APP_URL}/account`;
      // Non-blocking email send
      sendDownloadReady({
        to: customerEmail,
        stationTitle: stationTitle || 'Tide Station',
        link: accountUrl,
      }).catch(err => console.error('[webhook] Background email task failed:', err.message));
      console.log('[webhook] Triggered background email task for:', customerEmail);
    } else if (process.env.MOCK_EMAILS === 'true') {
      console.log('[webhook] Mock mode: skipping email send');
    }

    console.log('[webhook] Successfully processed checkout.session.completed');
  } catch (error) {
    console.error('[webhook] Error processing checkout.session.completed:', error);
    throw error; // Re-throw to be caught by webhook handler
  }
}
