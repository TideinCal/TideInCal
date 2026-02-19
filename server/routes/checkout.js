import { Router } from 'express';
import Stripe from 'stripe';
import { z } from 'zod';
import csurf from 'csurf';
import { attachUser, requireAuth } from '../auth/index.js';
import { getDatabase } from '../db/index.js';

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const csrfProtection = csurf({ cookie: false });

// Validation schema for plan-based checkout
const checkoutSchema = z.object({
  plan: z.enum(['single', 'unlimited']),
  stationID: z.string().min(1).optional(),
  stationTitle: z.string().min(1).optional(),
  country: z.string().min(1).optional()
}).refine((data) => {
  // For single plan, station fields are required
  if (data.plan === 'single') {
    return data.stationID && data.stationTitle && data.country;
  }
  return true;
}, {
  message: "stationID, stationTitle, and country are required for single plan"
});

// Apply middleware
router.use(attachUser);
router.use(requireAuth);

// POST /api/checkout/session
router.post('/session', csrfProtection, async (req, res) => {
  try {
    const validated = checkoutSchema.parse(req.body);
    const { plan, stationID, stationTitle, country } = validated;
    
    const db = getDatabase();
    const { ObjectId } = await import('mongodb');
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.user._id) });
    
    // Check if user has active subscription
    const hasActiveSubscription = user?.subscriptionStatus === 'active' && 
                                   user?.subscriptionCurrentPeriodEnd && 
                                   new Date(user.subscriptionCurrentPeriodEnd) > new Date();
    
    // If user has active subscription and is requesting single station, allow free generation
    // (No checkout needed - they can generate directly from dashboard)
    if (hasActiveSubscription && plan === 'single') {
      return res.status(400).json({ 
        error: 'You have an active subscription. Please use the dashboard to generate files for free.' 
      });
    }
    
    // Determine price and mode based on plan
    let priceId;
    let sessionMode;
    
    if (plan === 'unlimited') {
      // Unlimited is a one-year subscription
      priceId = process.env.STRIPE_PRICE_UNLIMITED;
      sessionMode = 'subscription';
    } else if (plan === 'single') {
      // Single is a one-time payment
      priceId = process.env.STRIPE_PRICE_SINGLE;
      sessionMode = 'payment';
    } else {
      throw new Error(`Invalid plan: ${plan}`);
    }
    
    // Validate that we have a valid price ID
    if (!priceId) {
      throw new Error(`Missing Stripe price configuration for ${plan} plan`);
    }

    const appUrl = process.env.APP_URL?.trim();
    if (!appUrl) {
      console.error('Checkout session error: APP_URL is not set');
      return res.status(503).json({ error: 'Checkout is not fully configured. Please try again later.' });
    }
    
    // Prepare metadata
    const metadata = {
      plan: plan === 'unlimited' ? 'subscription' : 'single',
      userId: req.user._id.toString()
    };
    
    // Add station info for single plan
    if (plan === 'single') {
      metadata.stationID = stationID;
      metadata.stationTitle = stationTitle;
      metadata.country = country;
    }
    
    // Use existing Stripe customer if available
    const sessionConfig = {
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: sessionMode,
      allow_promotion_codes: true,
      metadata,
      success_url: `${appUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/`,
    };
    
    // Use existing customer if available, otherwise use email
    if (user?.stripeCustomerId) {
      sessionConfig.customer = user.stripeCustomerId;
    } else {
      sessionConfig.customer_email = req.user.email;
    }
    
    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create(sessionConfig);
    
    res.json({ url: session.url });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Checkout session error:', error?.message ?? error);
    if (error?.stack) console.error('Checkout session error stack:', error.stack);
    if (error?.message?.includes('Missing Stripe price')) {
      return res.status(503).json({ error: 'Checkout is not fully configured. Please try again later.' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/checkout/verify - Verify checkout session and return purchase info
router.get('/verify', async (req, res) => {
  try {
    const { session_id } = req.query;
    
    if (!session_id) {
      return res.status(400).json({ ok: false, error: 'session_id is required' });
    }

    // Retrieve session from Stripe with expanded data
    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(session_id, {
        expand: ['line_items', 'subscription', 'customer']
      });
    } catch (stripeError) {
      console.error('[verify] Stripe error retrieving session:', stripeError);
      return res.status(404).json({ ok: false, error: 'Session not found in Stripe' });
    }
    
    if (!session) {
      return res.status(404).json({ ok: false, error: 'Session not found' });
    }

    // Verify session belongs to current user
    const db = getDatabase();
    const { ObjectId } = await import('mongodb');
    
    const metadata = session.metadata || {};
    const { userId, plan, stationID, stationTitle, country } = metadata;
    
    // Validate required metadata
    const missing = [];
    if (!userId) missing.push('userId');
    
    // For single plan or payment mode, station info is required
    if (plan === 'single' || session.mode === 'payment') {
      if (!stationID) missing.push('stationID');
      if (!stationTitle) missing.push('stationTitle');
      if (!country) missing.push('country');
    }
    
    if (missing.length > 0) {
      console.error('[verify] Missing session metadata:', missing.join(', '));
      return res.status(400).json({
        ok: false,
        error: `Missing session metadata: ${missing.join(', ')}`,
        ...(process.env.NODE_ENV !== 'production' && {
          debug: { session_id: session.id, metadata }
        })
      });
    }
    
    // Check if user is authenticated and matches session
    if (!req.user || req.user._id.toString() !== userId) {
      return res.status(401).json({ ok: false, error: 'Not authenticated or session does not belong to current user' });
    }

    // Check payment status - only proceed if paid
    let isPaid = session.payment_status === 'paid' || session.status === 'complete';
    
    // Fallback: if payment_intent exists, retrieve PI and check succeeded
    if (!isPaid && session.payment_intent) {
      try {
        const pi = await stripe.paymentIntents.retrieve(session.payment_intent);
        isPaid = pi.status === 'succeeded';
        console.log('[verify] PaymentIntent status:', pi.status, 'isPaid:', isPaid);
      } catch (piError) {
        console.error('[verify] Error retrieving PaymentIntent:', piError);
      }
    }
    
    // Check if purchase record exists before creating
    let purchase = await db.collection('purchases').findOne({
      stripeSessionId: session_id
    });
    const purchaseFoundBeforeCreate = !!purchase;
    let purchaseCreated = false;

    if (!isPaid) {
      // Session not paid yet, return 202 to indicate still processing
      console.log('[verify]', session.id, 'status:', session.status, 'payment_status:', session.payment_status, 'payment_intent:', session.payment_intent, 'isPaid:', isPaid, 'purchaseFoundBeforeCreate:', purchaseFoundBeforeCreate, 'purchaseCreated:', purchaseCreated);
      return res.status(202).json({ 
        ok: false,
        error: 'Payment not marked as paid yet',
        retry: true,
        debug: {
          session_status: session.status,
          payment_status: session.payment_status,
          payment_intent: session.payment_intent || null,
          mode: session.mode
        }
      });
    }

    // Session is paid - create purchase if it doesn't exist
    if (!purchase) {
      // Purchase doesn't exist but session is paid - create it immediately (idempotent)
      console.log('[verify] Session is paid but purchase not found, creating purchase record:', session_id);
      
      try {
        // Import the checkoutCompleted service to reuse purchase creation logic
        const { createPurchaseFromSession } = await import('../services/checkoutCompleted.js');
        purchase = await createPurchaseFromSession(session, db, ObjectId);
        
        if (!purchase) {
          console.error('[verify] Failed to create purchase record - createPurchaseFromSession returned null');
          console.log('[verify]', session.id, 'status:', session.status, 'payment_status:', session.payment_status, 'payment_intent:', session.payment_intent, 'isPaid:', isPaid, 'purchaseFoundBeforeCreate:', purchaseFoundBeforeCreate, 'purchaseCreated:', false);
          return res.status(500).json({ 
            ok: false, 
            error: 'Failed to create purchase record',
            debug: {
              session_status: session.status,
              payment_status: session.payment_status,
              payment_intent: session.payment_intent || null,
              mode: session.mode
            }
          });
        }
        
        purchaseCreated = true;
        console.log('[verify] Created purchase record:', purchase._id.toString());
      } catch (createError) {
        console.error('[verify] Error creating purchase record:', createError);
        console.error('[verify] Error stack:', createError.stack);
        console.log('[verify]', session.id, 'status:', session.status, 'payment_status:', session.payment_status, 'payment_intent:', session.payment_intent, 'isPaid:', isPaid, 'purchaseFoundBeforeCreate:', purchaseFoundBeforeCreate, 'purchaseCreated:', false);
        return res.status(500).json({ 
          ok: false, 
          error: 'Failed to create purchase record',
          debug: {
            session_status: session.status,
            payment_status: session.payment_status,
            payment_intent: session.payment_intent || null,
            mode: session.mode,
            error_message: createError.message
          }
        });
      }
    }
    
    // Log successful verification
    console.log('[verify]', session.id, 'status:', session.status, 'payment_status:', session.payment_status, 'payment_intent:', session.payment_intent, 'isPaid:', isPaid, 'purchaseFoundBeforeCreate:', purchaseFoundBeforeCreate, 'purchaseCreated:', purchaseCreated);

    // Determine purchase type
    const purchaseType = purchase.product === 'subscription' ? 'subscription' : 'one_time';

    // Return purchase info in required format
    res.json({
      ok: true,
      purchaseId: purchase._id.toString(),
      type: purchaseType
    });
  } catch (error) {
    console.error('[verify] Checkout verification error:', error);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

export default router;
