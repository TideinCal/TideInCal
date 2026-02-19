import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getDatabase } from '../db/index.js';
import { attachUser, requireAuth } from '../auth/index.js';
import { generateICS } from '../ics/index.js';
import { z } from 'zod';
import Stripe from 'stripe';
import csurf from 'csurf';

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const csrfProtection = csurf({ cookie: false });

const stationCache = new Map();

function getStationsForCountry(country) {
  if (!['usa', 'canada'].includes(country)) return null;
  if (stationCache.has(country)) {
    return stationCache.get(country);
  }
  const filePath = path.join(process.cwd(), 'data', `${country}_stations.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const stations = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    stationCache.set(country, stations);
    return stations;
  } catch (error) {
    console.error('[downloads] Failed to read station data:', error);
    return null;
  }
}

function resolveStationTitle(country, stationID) {
  const stations = getStationsForCountry(country);
  if (!stations) return null;
  const match = stations.find((station) => String(station.id) === String(stationID));
  return match?.name || null;
}

// Apply middleware
router.use(attachUser);
router.use(requireAuth);

// Validation schema for purchase ID
const purchaseIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid purchase ID format');

// Validation schema for generation request
const generateSchema = z.object({
  stationID: z.string().min(1),
  stationTitle: z.string().min(1),
  country: z.enum(['usa', 'canada']),
  includeMoon: z.boolean().optional().default(false),
  userTimezone: z.string().optional().default('UTC'),
  feet: z.boolean().optional().default(false)
});

/**
 * POST /api/downloads/regenerate/:purchaseId
 * Regenerates ICS file for a one-time purchase
 * Only works if purchase is not expired (within 365 days)
 */
router.post('/regenerate/:purchaseId', csrfProtection, async (req, res) => {
  try {
    // Validate purchase ID
    const validation = purchaseIdSchema.safeParse(req.params.purchaseId);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid purchase ID', 
        details: validation.error.errors 
      });
    }
    
    const db = getDatabase();
    const { ObjectId } = await import('mongodb');
    const purchaseId = validation.data;
    
    // Find purchase and verify ownership
    const purchase = await db.collection('purchases').findOne({
      _id: new ObjectId(purchaseId),
      userId: new ObjectId(req.user._id),
      product: 'single'
    });
    
    if (!purchase) {
      return res.status(404).json({ error: 'Purchase not found or access denied' });
    }
    
    // Check if purchase is expired
    const now = new Date();
    if (purchase.expiresAt && new Date(purchase.expiresAt) < now) {
      return res.status(410).json({ 
        error: 'Purchase has expired',
        expiresAt: purchase.expiresAt,
        message: 'This purchase expired more than 365 days ago. Please purchase again to regenerate.'
      });
    }
    
    // Check if purchase date is valid (should have purchaseDate or createdAt)
    const purchaseDate = purchase.purchaseDate || purchase.createdAt;
    const daysSincePurchase = (now - new Date(purchaseDate)) / (1000 * 60 * 60 * 24);
    
    if (daysSincePurchase > 365) {
      return res.status(410).json({ 
        error: 'Purchase has expired',
        purchaseDate: purchaseDate,
        message: 'This purchase is more than 365 days old. Please purchase again to regenerate.'
      });
    }
    
    // Get regeneration parameters
    const params = purchase.regenerationParams;
    if (!params) {
      return res.status(500).json({ error: 'Regeneration parameters not found' });
    }
    
    // Generate ICS content on-demand
    console.log('[downloads] Regenerating ICS for purchase:', purchaseId);
    const icsContent = await generateICS({
      id: params.stationId,
      title: params.stationTitle,
      country: params.country,
      includeMoon: params.includeMoon || false,
      userTimezone: params.userTimezone || 'UTC',
      feet: params.feet || false
    });
    
    // Stream file directly in response
    const fileName = `${params.stationTitle.replace(/[^a-zA-Z0-9]/g, '_')}.ics`;
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(icsContent);
    
    console.log('[downloads] Successfully regenerated and streamed ICS file');
  } catch (error) {
    console.error('Error regenerating file:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/downloads/generate
 * Generates ICS file for subscription users (unlimited access)
 * Requires active subscription
 */
router.post('/generate', csrfProtection, async (req, res) => {
  try {
    // Validate request body
    const validated = generateSchema.parse(req.body);
    const { stationID, stationTitle, country, includeMoon, userTimezone, feet } = validated;
    
    const db = getDatabase();
    const { ObjectId } = await import('mongodb');
    
    // Check if user has active subscription
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.user._id) });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Verify subscription is active (check user record first)
    let hasActiveSubscription = user.subscriptionStatus === 'active' && 
                                user.subscriptionCurrentPeriodEnd && 
                                new Date(user.subscriptionCurrentPeriodEnd) > new Date();
    
    let subscriptionId = user.stripeSubscriptionId;
    let subscriptionPeriodEnd = user.subscriptionCurrentPeriodEnd ? new Date(user.subscriptionCurrentPeriodEnd) : null;
    
    // Fallback: If user record doesn't have subscription info, check purchase records
    // This handles race condition where webhook hasn't processed yet
    if (!hasActiveSubscription && !subscriptionId) {
      console.log('[downloads] User record missing subscription info, checking purchase records');
      const subscriptionPurchase = await db.collection('purchases').findOne({
        userId: new ObjectId(req.user._id),
        product: 'subscription',
        subscriptionStatus: 'active'
      }, {
        sort: { createdAt: -1 } // Get most recent
      });
      
      if (subscriptionPurchase && subscriptionPurchase.stripeSubscriptionId) {
        subscriptionId = subscriptionPurchase.stripeSubscriptionId;
        console.log('[downloads] Found subscription in purchase record:', subscriptionId);
        
        // Check if subscription period is still valid
        if (subscriptionPurchase.subscriptionCurrentPeriodEnd) {
          const periodEnd = new Date(subscriptionPurchase.subscriptionCurrentPeriodEnd);
          if (periodEnd > new Date()) {
            hasActiveSubscription = true;
            console.log('[downloads] Subscription period is valid until:', periodEnd);
          }
        }
      }
    }
    
    // If we have a subscription ID, verify with Stripe directly
    if (subscriptionId) {
      try {
        console.log('[downloads] Verifying subscription with Stripe:', subscriptionId);
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const isStripeActive = subscription.status === 'active';
        const currentPeriodEnd = subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000)
          : null;
        
        // Update user record with current subscription info
        await db.collection('users').updateOne(
          { _id: new ObjectId(req.user._id) },
          { 
            $set: { 
              stripeSubscriptionId: subscriptionId,
              subscriptionStatus: subscription.status,
              subscriptionCurrentPeriodEnd: currentPeriodEnd,
              unlimited: isStripeActive,
              updatedAt: new Date()
            }
          }
        );
        
        if (isStripeActive) {
          hasActiveSubscription = true;
          if (currentPeriodEnd) {
            subscriptionPeriodEnd = currentPeriodEnd;
          }
          console.log('[downloads] Stripe confirms subscription is active');
        } else {
          console.log('[downloads] Stripe reports subscription status:', subscription.status);
          return res.status(403).json({ 
            error: 'Subscription not active',
            message: `Your subscription status is: ${subscription.status}. Please renew to continue generating files.`
          });
        }
      } catch (stripeError) {
        console.error('[downloads] Error verifying subscription with Stripe:', stripeError);
        // If we had a valid local check, continue; otherwise fail
        if (!hasActiveSubscription) {
          return res.status(403).json({ 
            error: 'Unable to verify subscription',
            message: 'Could not verify subscription status. Please try again or contact support.'
          });
        }
      }
    }
    
    // Final check - reject if no active subscription found
    if (!hasActiveSubscription) {
      console.log('[downloads] No active subscription found for user:', req.user._id);
      return res.status(403).json({ 
        error: 'Active subscription required',
        message: 'You need an active subscription to generate files. Please subscribe to continue.'
      });
    }
    
    // Resolve station title if missing/placeholder
    let resolvedStationTitle = stationTitle;
    if (!resolvedStationTitle || resolvedStationTitle === 'Tide Station') {
      const lookedUpTitle = resolveStationTitle(country, stationID);
      if (lookedUpTitle) {
        resolvedStationTitle = lookedUpTitle;
      }
    }

    // Generate ICS content on-demand
    console.log('[downloads] Generating ICS for subscription user:', req.user._id);
    const icsContent = await generateICS({
      id: stationID,
      title: resolvedStationTitle,
      country,
      includeMoon: includeMoon || false,
      userTimezone: userTimezone || 'UTC',
      feet: feet || false,
      startDate: new Date(),
      endDate: subscriptionPeriodEnd || null
    });
    
    // Stream file directly in response
    const safeTitle = (resolvedStationTitle || stationID || 'tide-calendar').replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `${safeTitle}.ics`;
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    
    // Track subscription download history for account page
    try {
      await db.collection('subscription_downloads').updateOne(
        {
          userId: new ObjectId(req.user._id),
          stationId: String(stationID),
          country: country
        },
        {
          $set: {
            stationTitle: resolvedStationTitle || stationTitle || 'Tide Station',
            updatedAt: new Date()
          },
          $setOnInsert: {
            createdAt: new Date()
          },
          $inc: {
            downloadCount: 1
          }
        },
        { upsert: true }
      );
    } catch (historyError) {
      console.error('[downloads] Failed to track subscription download:', historyError);
      // Do not fail the request if tracking fails
    }

    res.send(icsContent);
    
    console.log('[downloads] Successfully generated and streamed ICS file for subscription user');
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Error generating file:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

