import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getDatabase } from '../db/index.js';
import { attachUser, requireAuth } from '../auth/index.js';
import { generateICS, mergeTideAndGoldenHourICS } from '../ics/index.js';
import { generateMoonCalendar, addCalendarYear } from '../ics/moonCalendar.js';
import { generateGoldenHourICS } from '../ics/goldenHour.js';
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
  feet: z.boolean().optional().default(false),
  // Optional flag used only for tracking whether a given subscription download
  // included Golden Hour for that specific location (for My Account display).
  includeGoldenHour: z.boolean().optional().default(false)
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
    
    const userTimezone = params.userTimezone || 'UTC';
    const includeGolden = params.includeGoldenHour === true;
    let goldenParams = null;
    if (includeGolden && params.goldenLat != null && params.goldenLng != null) {
      goldenParams = {
        lat: params.goldenLat,
        lng: params.goldenLng,
        locationName: params.goldenLocationName || params.stationTitle || 'Location',
        userTimezone
      };
    }
    // Legacy: bundled Golden Hour was a separate purchase; find sibling to get coords
    if (includeGolden && !goldenParams && purchase.stripeSessionId) {
      const siblingGolden = await db.collection('purchases').findOne({
        stripeSessionId: purchase.stripeSessionId,
        product: 'golden',
        'regenerationParams.bundledWithTide': true
      });
      if (siblingGolden?.regenerationParams?.lat != null) {
        const r = siblingGolden.regenerationParams;
        goldenParams = {
          lat: r.lat,
          lng: r.lng,
          locationName: r.locationName || params.stationTitle || 'Location',
          userTimezone: r.userTimezone || userTimezone
        };
      }
    }
    
    // Generate ICS content on-demand
    console.log('[downloads] Regenerating ICS for purchase:', purchaseId, includeGolden ? '(tide + Golden Hour)' : '');
    const tideIcs = await generateICS({
      id: params.stationId,
      title: params.stationTitle,
      country: params.country,
      userTimezone,
      feet: params.feet || false
    });
    
    let icsContent = tideIcs;
    if (goldenParams) {
      const startDate = purchaseDate ? new Date(purchaseDate) : new Date();
      const basePurchaseDate = purchaseDate || purchase.createdAt;
      const endDate = purchase.expiresAt
        ? new Date(purchase.expiresAt)
        : basePurchaseDate
          ? new Date(new Date(basePurchaseDate).getTime() + 365 * 24 * 60 * 60 * 1000)
          : new Date(startDate.getTime() + 365 * 24 * 60 * 60 * 1000);
      const goldenIcs = await generateGoldenHourICS({
        lat: goldenParams.lat,
        lng: goldenParams.lng,
        locationName: goldenParams.locationName,
        startDate,
        endDate,
        timezone: goldenParams.userTimezone
      });
      const calendarName = `Tide + Golden Hour - ${params.stationTitle}`;
      icsContent = mergeTideAndGoldenHourICS(tideIcs, goldenIcs, calendarName, goldenParams.userTimezone);
    }
    
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
    const { stationID, stationTitle, country, includeMoon, userTimezone, feet, includeGoldenHour } = validated;
    
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
        const storedPeriodEnd = user.subscriptionCurrentPeriodEnd
          ? new Date(user.subscriptionCurrentPeriodEnd)
          : null;
        const periodEnd = currentPeriodEnd || storedPeriodEnd;

        // Update user record with current subscription info; only persist period end when Stripe provides it
        const updateSet = {
          stripeSubscriptionId: subscriptionId,
          subscriptionStatus: subscription.status,
          unlimited: isStripeActive && !!periodEnd && periodEnd > new Date(),
          updatedAt: new Date()
        };
        if (currentPeriodEnd) {
          updateSet.subscriptionCurrentPeriodEnd = currentPeriodEnd;
        }
        await db.collection('users').updateOne(
          { _id: new ObjectId(req.user._id) },
          { $set: updateSet }
        );

        if (isStripeActive) {
          hasActiveSubscription = true;
          if (periodEnd) {
            subscriptionPeriodEnd = periodEnd;
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
              updatedAt: new Date(),
              includeGoldenHour: !!includeGoldenHour
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

/**
 * POST /api/downloads/moon
 * Generates a standalone moon phases ICS calendar for users with entitlement.
 * Supports access via active Pro subscription and/or standalone moon purchases.
 */
router.post('/moon', csrfProtection, async (req, res) => {
  try {
    const db = getDatabase();
    const { ObjectId } = await import('mongodb');

    const user = await db.collection('users').findOne({ _id: new ObjectId(req.user._id) });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Determine Pro (subscription) entitlement
    let hasActiveSubscription = user.subscriptionStatus === 'active' &&
      user.subscriptionCurrentPeriodEnd &&
      new Date(user.subscriptionCurrentPeriodEnd) > new Date();

    let subscriptionEnd = user.subscriptionCurrentPeriodEnd
      ? new Date(user.subscriptionCurrentPeriodEnd)
      : null;

    // Fallback: check purchases for subscription info if needed
    if (!hasActiveSubscription) {
      const subscriptionPurchase = await db.collection('purchases').findOne(
        {
          userId: new ObjectId(req.user._id),
          product: 'subscription'
        },
        { sort: { createdAt: -1 } }
      );

      if (subscriptionPurchase && subscriptionPurchase.subscriptionCurrentPeriodEnd) {
        const periodEnd = new Date(subscriptionPurchase.subscriptionCurrentPeriodEnd);
        if (periodEnd > new Date()) {
          hasActiveSubscription = true;
          subscriptionEnd = periodEnd;
        }
      }
    }

    // Determine standalone moon entitlements
    const moonPurchases = await db.collection('purchases')
      .find({
        userId: new ObjectId(req.user._id),
        product: 'moon'
      })
      .toArray();

    const now = new Date();
    let standaloneStart = null;
    let standaloneEnd = null;
    let standaloneAllowed = false;

    for (const p of moonPurchases) {
      const purchaseDate = p.purchaseDate || p.createdAt;
      if (!purchaseDate) continue;
      const entitlementEnd = p.entitlementEnd || addCalendarYear(purchaseDate);

      if (entitlementEnd >= now) {
        standaloneAllowed = true;
        if (!standaloneStart || purchaseDate < standaloneStart) {
          standaloneStart = purchaseDate;
        }
        if (!standaloneEnd || entitlementEnd > standaloneEnd) {
          standaloneEnd = entitlementEnd;
        }
      }
    }

    const proAllowed = hasActiveSubscription && !!subscriptionEnd;
    const anyAllowed = proAllowed || standaloneAllowed;

    if (!anyAllowed) {
      return res.status(403).json({
        error: 'Moon calendar access required',
        message: 'You need Pro or a standalone moon calendar purchase to generate moon phases.'
      });
    }

    // Effective generation rule: generated range = today → current entitlement end (inclusive)
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    let effectiveEnd = null;
    if (proAllowed && subscriptionEnd) effectiveEnd = subscriptionEnd;
    if (standaloneAllowed && standaloneEnd) {
      const endDate = standaloneEnd;
      effectiveEnd = effectiveEnd ? new Date(Math.max(effectiveEnd.getTime(), endDate.getTime())) : endDate;
    }
    const endUtc = effectiveEnd ? new Date(Date.UTC(effectiveEnd.getUTCFullYear(), effectiveEnd.getUTCMonth(), effectiveEnd.getUTCDate())) : null;

    if (!endUtc || endUtc < todayUtc) {
      return res.status(400).json({
        error: 'No remaining entitlement',
        message: 'Your moon calendar access has ended or has no remaining days.'
      });
    }

    const userTimezone = (req.body && req.body.userTimezone != null)
      ? String(req.body.userTimezone).trim() || 'UTC'
      : 'UTC';
    const icsContent = generateMoonCalendar(todayUtc, endUtc, userTimezone);
    const year = todayUtc.getUTCFullYear();
    const filename = `moon-phases-${year}.ics`;

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(icsContent);
  } catch (error) {
    console.error('Error generating moon calendar:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/downloads/golden/regenerate/:purchaseId
 * Regenerates Golden Hour ICS for a Golden Hour purchase (product === 'golden').
 */
router.post('/golden/regenerate/:purchaseId', csrfProtection, async (req, res) => {
  try {
    const validation = purchaseIdSchema.safeParse(req.params.purchaseId);
    if (!validation.success) {
      return res.status(400).json({ error: 'Invalid purchase ID', details: validation.error.errors });
    }
    const db = getDatabase();
    const { ObjectId } = await import('mongodb');
    const purchaseId = validation.data;

    const purchase = await db.collection('purchases').findOne({
      _id: new ObjectId(purchaseId),
      userId: new ObjectId(req.user._id),
      product: 'golden'
    });
    if (!purchase) {
      return res.status(404).json({ error: 'Purchase not found or access denied' });
    }
    const now = new Date();
    if (purchase.expiresAt && new Date(purchase.expiresAt) < now) {
      return res.status(410).json({
        error: 'Purchase has expired',
        message: 'This Golden Hour purchase has expired. Please purchase again to regenerate.'
      });
    }
    const params = purchase.regenerationParams;
    if (!params || typeof params.lat !== 'number' || typeof params.lng !== 'number') {
      return res.status(500).json({ error: 'Regeneration parameters not found' });
    }
    const purchaseDate = purchase.purchaseDate || purchase.createdAt;
    const startDate = purchaseDate ? new Date(purchaseDate) : new Date();
    const endDate = purchase.expiresAt
      ? new Date(purchase.expiresAt)
      : purchaseDate
        ? new Date(new Date(purchaseDate).getTime() + 365 * 24 * 60 * 60 * 1000)
        : new Date(startDate.getTime() + 365 * 24 * 60 * 60 * 1000);
    const timezone = (params.userTimezone && String(params.userTimezone).trim()) || 'UTC';
    const icsContent = generateGoldenHourICS({
      lat: params.lat,
      lng: params.lng,
      locationName: params.locationName || 'Location',
      startDate,
      endDate,
      timezone
    });
    const safeName = (params.locationName || 'golden-hour').replace(/[^a-zA-Z0-9]/g, '_');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-golden-hour.ics"`);
    res.send(icsContent);
  } catch (error) {
    console.error('Error regenerating Golden Hour file:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const goldenGenerateSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  locationName: z.string().min(1).optional().default('Location'),
  userTimezone: z.string().optional().default('UTC')
});

/**
 * POST /api/downloads/golden
 * Generates Golden Hour ICS for Pro users (any location). No purchase required.
 */
router.post('/golden', csrfProtection, async (req, res) => {
  try {
    const validated = goldenGenerateSchema.parse(req.body);
    const db = getDatabase();
    const { ObjectId } = await import('mongodb');

    const user = await db.collection('users').findOne({ _id: new ObjectId(req.user._id) });
    if (!user) return res.status(404).json({ error: 'User not found' });

    let hasActiveSubscription = user.subscriptionStatus === 'active' &&
      user.subscriptionCurrentPeriodEnd &&
      new Date(user.subscriptionCurrentPeriodEnd) > new Date();
    let subscriptionEnd = user.subscriptionCurrentPeriodEnd
      ? new Date(user.subscriptionCurrentPeriodEnd)
      : null;
    if (!hasActiveSubscription && user.stripeSubscriptionId) {
      try {
        const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
        hasActiveSubscription = subscription.status === 'active';
        if (subscription.current_period_end) {
          const periodEnd = new Date(subscription.current_period_end * 1000);
          if (periodEnd > new Date()) {
            hasActiveSubscription = true;
            subscriptionEnd = periodEnd;
          }
        }
      } catch (_) {}
    }
    if (!hasActiveSubscription) {
      const subPurchase = await db.collection('purchases').findOne({
        userId: new ObjectId(req.user._id),
        product: 'subscription'
      }, { sort: { createdAt: -1 } });
      if (subPurchase?.subscriptionCurrentPeriodEnd && new Date(subPurchase.subscriptionCurrentPeriodEnd) > new Date()) {
        hasActiveSubscription = true;
        subscriptionEnd = new Date(subPurchase.subscriptionCurrentPeriodEnd);
      }
    }
    if (!hasActiveSubscription) {
      return res.status(403).json({
        error: 'Pro subscription required',
        message: 'Golden Hour generation for any location requires an active Pro subscription.'
      });
    }

    if (!subscriptionEnd) {
      return res.status(400).json({
        error: 'Subscription period end unavailable',
        message: 'Unable to determine your subscription period end. Please try again or contact support.'
      });
    }
    const endDate = subscriptionEnd;
    const startDate = new Date();
    const timezone = (validated.userTimezone && String(validated.userTimezone).trim()) || 'UTC';
    const icsContent = generateGoldenHourICS({
      lat: validated.lat,
      lng: validated.lng,
      locationName: validated.locationName,
      startDate,
      endDate,
      timezone
    });
    const safeName = (validated.locationName || 'golden-hour').replace(/[^a-zA-Z0-9]/g, '_');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-golden-hour.ics"`);
    res.send(icsContent);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Error generating Golden Hour:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

