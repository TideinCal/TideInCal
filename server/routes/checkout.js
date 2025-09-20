import { Router } from 'express';
import Stripe from 'stripe';
import { z } from 'zod';
import { attachUser, requireAuth } from '../auth/index.js';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Validation schema for checkout session
const checkoutSchema = z.object({
  stationID: z.string().min(1),
  stationTitle: z.string().min(1),
  country: z.string().min(1),
  includeMoon: z.boolean().optional(),
  unlimited: z.boolean().optional()
});

// Apply middleware
router.use(attachUser);
router.use(requireAuth);

// POST /api/checkout/session
router.post('/session', async (req, res) => {
  try {
    const validated = checkoutSchema.parse(req.body);
    const { stationID, stationTitle, country, includeMoon, unlimited } = validated;
    
    // Determine price based on options
    let priceId = process.env.STRIPE_PRICE_SINGLE_DOWNLOAD;
    let productName = 'Single Download';
    
    if (unlimited) {
      priceId = process.env.STRIPE_PRICE_UNLIMITED;
      productName = 'Unlimited Access';
    } else if (includeMoon) {
      // For single download with moon, we'll need to handle this in webhook
      // For now, use single download price
      productName = 'Single Download + Moon';
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
      metadata: {
        userId: req.user._id.toString(),
        stationID,
        stationTitle,
        country,
        includeMoon: includeMoon ? 'true' : 'false',
        unlimited: unlimited ? 'true' : 'false'
      },
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
