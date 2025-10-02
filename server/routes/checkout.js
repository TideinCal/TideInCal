import { Router } from 'express';
import Stripe from 'stripe';
import { z } from 'zod';
import { attachUser, requireAuth } from '../auth/index.js';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
router.post('/session', async (req, res) => {
  try {
    const validated = checkoutSchema.parse(req.body);
    const { plan, stationID, stationTitle, country } = validated;
    
    // Determine price based on plan
    let priceId;
    let productName;
    
    if (plan === 'unlimited') {
      priceId = process.env.STRIPE_PRICE_UNLIMITED;
      productName = 'Unlimited Access';
    } else if (plan === 'single') {
      priceId = process.env.STRIPE_PRICE_SINGLE;
      productName = 'Single Station';
    }
    
    // Validate that we have a valid price ID
    if (!priceId) {
      throw new Error(`Missing Stripe price configuration for ${plan} plan`);
    }
    
    // Prepare metadata
    const metadata = {
      plan,
      userId: req.user._id.toString()
    };
    
    // Add station info for single plan
    if (plan === 'single') {
      metadata.stationID = stationID;
      metadata.stationTitle = stationTitle;
      metadata.country = country;
    }
    
    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'payment',
      customer_email: req.user.email,
      metadata,
      success_url: `${process.env.APP_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL}/`,
    });
    
    res.json({ url: session.url });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Checkout session error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
