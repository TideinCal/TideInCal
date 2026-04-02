import { Router } from 'express';
import Stripe from 'stripe';
import { z } from 'zod';
import csurf from 'csurf';
import { attachUser, requireAuth } from '../auth/index.js';
import { getDatabase } from '../db/index.js';

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const csrfProtection = csurf({ cookie: false });

/**
 * Returns session options for Pro coupon (allow_promotion_codes and discounts).
 * Exported for tests. Stripe allows either discounts OR allow_promotion_codes, not both.
 * @param {string} plan - 'single' | 'unlimited'
 * @param {boolean|string} useProOffer - from client (true or 'true' when upsell timer is active)
 * @param {string|undefined} envCoupon - STRIPE_PRO_UPGRADE_COUPON value
 * @returns {{ allow_promotion_codes: boolean, discounts?: Array<{ coupon: string }> }}
 */
export function getProCouponSessionOptions(plan, useProOffer, envCoupon) {
  const proCoupon = (envCoupon || '').trim() || null;
  const useProOfferTruthy = useProOffer === true || useProOffer === 'true';
  const applyProCoupon = plan === 'unlimited' && useProOfferTruthy && !!proCoupon;
  return {
    allow_promotion_codes: !applyProCoupon,
    ...(applyProCoupon && proCoupon && { discounts: [{ coupon: proCoupon }] })
  };
}

// Validation schema for plan-based checkout (useProOffer can be boolean or string 'true' from JSON)
const checkoutSchema = z.object({
  plan: z.enum(['single', 'unlimited']),
  stationID: z.string().min(1).optional(),
  stationTitle: z.string().min(1).optional(),
  country: z.string().min(1).optional(),
  stationLat: z.number().optional(),
  stationLng: z.number().optional(),
  useProOffer: z.optional(
    z.union([z.boolean(), z.literal('true'), z.literal('false')]).transform((v) => v === true || v === 'true')
  ),
  includeMoon: z.boolean().optional().default(false),
  includeGoldenHour: z.boolean().optional().default(false),
  goldenOnly: z.boolean().optional().default(false),
  goldenLat: z.number().optional(),
  goldenLng: z.number().optional(),
  goldenLocationName: z.string().optional(),
  userTimezone: z.string().optional()
}).refine((data) => {
  if (data.plan === 'unlimited') return true;
  if (data.goldenOnly) {
    return typeof data.goldenLat === 'number' && typeof data.goldenLng === 'number' && data.goldenLocationName != null && data.goldenLocationName !== '';
  }
  return !!(data.stationID && data.stationTitle && data.country);
}, {
  message: "For single plan: either stationID/stationTitle/country (tide), or goldenOnly with goldenLat/goldenLng/goldenLocationName"
});

// Apply middleware
router.use(attachUser);
router.use(requireAuth);

// POST /api/checkout/session
router.post('/session', csrfProtection, async (req, res) => {
  try {
    const validated = checkoutSchema.parse(req.body);
    const { plan, stationID, stationTitle, country, stationLat, stationLng, useProOffer, includeMoon, includeGoldenHour, goldenOnly, goldenLat, goldenLng, goldenLocationName, userTimezone } = validated;
    
    const db = getDatabase();
    const { ObjectId } = await import('mongodb');
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.user._id) });
    
    // Check if user has active subscription
    const hasActiveSubscription = user?.subscriptionStatus === 'active' && 
                                   user?.subscriptionCurrentPeriodEnd && 
                                   new Date(user.subscriptionCurrentPeriodEnd) > new Date();
    
    // Block double-charge: active subscribers should not be able to purchase again
    if (hasActiveSubscription && plan === 'unlimited') {
      return res.status(400).json({ 
        error: 'You already have an active Pro subscription.' 
      });
    }
    if (hasActiveSubscription && plan === 'single' && !goldenOnly) {
      return res.status(400).json({ 
        error: 'You have an active subscription. Please use the dashboard to generate files for free.' 
      });
    }

    const appUrl = process.env.APP_URL?.trim();
    if (!appUrl) {
      console.error('Checkout session error: APP_URL is not set');
      return res.status(503).json({ error: 'Checkout is not fully configured. Please try again later.' });
    }

    let sessionMode = 'payment';
    const lineItems = [];
    const metadata = {
      plan: plan === 'unlimited' ? 'subscription' : 'single',
      userId: req.user._id.toString(),
      includeMoon: includeMoon === true,
      includeGoldenHour: includeGoldenHour === true,
      userTimezone: (userTimezone && String(userTimezone).trim()) || (req.body.userTimezone && String(req.body.userTimezone).trim()) || ''
    };

    if (plan === 'unlimited') {
      sessionMode = 'subscription';
      const priceId = process.env.STRIPE_PRICE_UNLIMITED;
      if (!priceId) throw new Error('Missing Stripe price configuration for unlimited plan');
      lineItems.push({ price: priceId, quantity: 1 });
    } else {
      // plan === 'single': (a) tide only, (b) golden only, (c) tide + golden
      if (goldenOnly) {
        const priceId = process.env.STRIPE_PRICE_GOLDEN || process.env.STRIPE_GOLDEN_HOUR;
        if (!priceId) throw new Error('Missing Stripe price configuration for Golden Hour (STRIPE_PRICE_GOLDEN or STRIPE_GOLDEN_HOUR)');
        lineItems.push({ price: priceId, quantity: 1 });
        metadata.productType = 'golden';
        metadata.goldenLat = String(goldenLat);
        metadata.goldenLng = String(goldenLng);
        metadata.goldenLocationName = goldenLocationName || 'Location';
      } else {
        const tidePriceId = process.env.STRIPE_PRICE_SINGLE;
        if (!tidePriceId) throw new Error('Missing Stripe price configuration for single plan');
        lineItems.push({ price: tidePriceId, quantity: 1 });
        metadata.stationID = stationID;
        metadata.stationTitle = stationTitle;
        metadata.country = country;
        if (typeof stationLat === 'number') metadata.stationLat = String(stationLat);
        if (typeof stationLng === 'number') metadata.stationLng = String(stationLng);

        if (includeGoldenHour) {
          const goldenPriceId = process.env.STRIPE_PRICE_GOLDEN || process.env.STRIPE_GOLDEN_HOUR;
          if (!goldenPriceId) throw new Error('Missing Stripe price configuration for Golden Hour (STRIPE_PRICE_GOLDEN or STRIPE_GOLDEN_HOUR)');
          lineItems.push({ price: goldenPriceId, quantity: 1 });
          metadata.productType = 'tide_and_golden';
          const glat = validated.goldenLat ?? req.body.goldenLat;
          const glng = validated.goldenLng ?? req.body.goldenLng;
          metadata.goldenLat = glat != null ? String(glat) : '';
          metadata.goldenLng = glng != null ? String(glng) : '';
          metadata.goldenLocationName = (validated.goldenLocationName ?? req.body.goldenLocationName ?? stationTitle ?? 'Location') || 'Location';
        } else {
          metadata.productType = 'tide';
        }
      }
    }

    // Pro upgrade coupon: only when unlimited + client sent offer flag + env is set
    const proCoupon = process.env.STRIPE_PRO_UPGRADE_COUPON?.trim() || null;
    const couponOptions = getProCouponSessionOptions(plan, useProOffer, process.env.STRIPE_PRO_UPGRADE_COUPON);
    const applyProCoupon = !!couponOptions.discounts;

    if (plan === 'unlimited') {
      console.log('[checkout] unlimited request: useProOffer=', useProOffer, 'couponEnv=', proCoupon ? `${proCoupon.slice(0, 4)}...${proCoupon.slice(-2)}` : 'missing', 'applyProCoupon=', applyProCoupon);
    }

    const sessionConfig = {
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: sessionMode,
      metadata,
      success_url: `${appUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/`,
    };
    if (couponOptions.discounts) {
      sessionConfig.discounts = couponOptions.discounts;
    } else {
      sessionConfig.allow_promotion_codes = true;
    }

    // Prefer attaching an existing Stripe customer when we have a valid ID,
    // but fall back to customer_email if the stored value is missing or malformed
    let customerId = user?.stripeCustomerId;
    if (customerId && typeof customerId === 'object') {
      // Guard against legacy data where a full customer object/hash was stored
      customerId = customerId.id || customerId.customer || null;
    }
    if (typeof customerId === 'string' && customerId.startsWith('cus_')) {
      sessionConfig.customer = customerId;
    } else {
      sessionConfig.customer_email = req.user.email;
    }

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
    const { userId, plan, stationID, stationTitle, country, productType, goldenLat, goldenLng, goldenLocationName } = metadata;
    
    // Validate required metadata
    const missing = [];
    if (!userId) missing.push('userId');
    
    if (plan === 'single' || session.mode === 'payment') {
      if (productType === 'golden') {
        if (goldenLat === undefined || goldenLat === '') missing.push('goldenLat');
        if (goldenLng === undefined || goldenLng === '') missing.push('goldenLng');
        if (!goldenLocationName) missing.push('goldenLocationName');
      } else {
        if (!stationID) missing.push('stationID');
        if (!stationTitle) missing.push('stationTitle');
        if (!country) missing.push('country');
      }
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

    // Determine purchase type for client (subscription | one_time)
    const purchaseType = purchase.product === 'subscription' ? 'subscription' : 'one_time';
    // Product kind so success page can route Golden Hour-only to /account, tide to dlFile.html
    const product = purchase.product; // 'subscription' | 'single' | 'golden'

    res.json({
      ok: true,
      purchaseId: purchase._id.toString(),
      type: purchaseType,
      product: product
    });
  } catch (error) {
    console.error('[verify] Checkout verification error:', error);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

export default router;
