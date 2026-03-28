import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import csurf from 'csurf';
import { getDatabase } from '../db/index.js';
import { 
  hashPassword, 
  verifyPassword, 
  signupSchema, 
  loginSchema,
  passwordSchema,
  attachUser,
  requireAuth
} from '../auth/index.js';
import { 
  sendEmailVerification,
  sendPasswordReset,
  sendPasswordChangeConfirmation
} from '../auth/email.js';
import { z } from 'zod';

const router = Router();
const csrfProtection = csurf({ cookie: false });

const stationCache = new Map();

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PASSWORD_RESET_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function createEmailVerificationToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);
  return { token, tokenHash, expiresAt };
}

function createPasswordResetToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
  return { token, tokenHash, expiresAt };
}

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
    console.error('[auth] Failed to read station data:', error);
    return null;
  }
}

function resolveStationTitle(country, stationId) {
  if (!country || !stationId) return null;
  const stations = getStationsForCountry(country);
  if (!stations) return null;
  const match = stations.find((station) => String(station.id) === String(stationId));
  return match?.name || null;
}

function normalizeSubscriptionPeriodEnd(subscription) {
  let periodEnd = null;
  const raw = subscription?.current_period_end;
  if (raw) {
    const ts = typeof raw === 'number' ? raw : Number(raw);
    if (!isNaN(ts) && ts > 0) {
      periodEnd = new Date(ts * 1000);
      if (isNaN(periodEnd.getTime()) || periodEnd.getTime() < new Date('2000-01-01').getTime()) {
        console.warn('[normalizeSubscriptionPeriodEnd] Rejected period end:', raw, '->', periodEnd);
        periodEnd = null;
      }
    } else {
      console.warn('[normalizeSubscriptionPeriodEnd] current_period_end not numeric:', typeof raw, raw);
    }
  }

  return periodEnd;
}

function normalizeStoredPeriodEnd(value) {
  if (!value) return null;
  const date = new Date(value);
  if (isNaN(date.getTime()) || date.getTime() < new Date('2000-01-01').getTime()) {
    return null;
  }
  return date;
}

// Brute-force protection: only login, signup, forgot-password, reset-password
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  },
});

// Apply attachUser to all auth routes
router.use(attachUser);

// POST /api/auth/signup
router.post('/signup', authLimiter, async (req, res) => {
  try {
    const validated = signupSchema.parse(req.body);
    const { email, password, firstName, lastName } = validated;
    
    const db = getDatabase();
    
    // Check if user already exists
    const existingUser = await db.collection('users').findOne({ email });
    if (existingUser) {
      return res.status(409).json({ error: 'User already exists' });
    }
    
    // Hash password and create user
    const passwordHash = await hashPassword(password);
    const now = new Date();
    const verification = createEmailVerificationToken();
    
    const result = await db.collection('users').insertOne({
      email,
      passwordHash,
      firstName: firstName || null,
      lastName: lastName || null,
      emailVerifiedAt: null,
      emailVerificationTokenHash: verification.tokenHash,
      emailVerificationTokenExpiresAt: verification.expiresAt,
      stripeCustomerId: null,
      unlimited: false,
      unlimitedSince: null,
      entitlements: [],
      createdAt: now,
      updatedAt: now
    });
    
    // Set session
    req.session.userId = result.insertedId;
    
    // Return user without sensitive data
    const user = {
      _id: result.insertedId,
      email,
      firstName,
      lastName
    };
    
    if (process.env.MOCK_EMAILS !== 'true') {
      sendEmailVerification({ to: email, token: verification.token })
        .catch((error) => console.error('[auth] Failed to send verification email:', error));
    }

    res.status(201).json({ user, verificationSent: true });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  try {
    const validated = loginSchema.parse(req.body);
    const { email, password } = validated;
    
    const db = getDatabase();
    
    // Find user
    const user = await db.collection('users').findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Verify password
    const isValidPassword = await verifyPassword(user.passwordHash, password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Set session
    req.session.userId = user._id;
    
    // Return user without sensitive data
    const userResponse = {
      _id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      emailVerifiedAt: user.emailVerifiedAt || null
    };
    
    res.json({ user: userResponse });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/verify-email
router.get('/verify-email', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Verification token is required' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const db = getDatabase();
    const now = new Date();

    const user = await db.collection('users').findOne({
      emailVerificationTokenHash: tokenHash,
      emailVerificationTokenExpiresAt: { $gt: now }
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }

    await db.collection('users').updateOne(
      { _id: user._id },
      {
        $set: { emailVerifiedAt: new Date(), updatedAt: new Date() },
        $unset: { emailVerificationTokenHash: '', emailVerificationTokenExpiresAt: '' }
      }
    );

    res.json({ ok: true, email: user.email });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/resend-verification
router.post('/resend-verification', async (req, res) => {
  try {
    const email = (req.body?.email || req.user?.email || '').toString().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const db = getDatabase();
    const user = await db.collection('users').findOne({ email });

    if (!user || user.emailVerifiedAt) {
      return res.json({ ok: true });
    }

    const verification = createEmailVerificationToken();
    await db.collection('users').updateOne(
      { _id: user._id },
      {
        $set: {
          emailVerificationTokenHash: verification.tokenHash,
          emailVerificationTokenExpiresAt: verification.expiresAt,
          updatedAt: new Date()
        }
      }
    );

    if (process.env.MOCK_EMAILS !== 'true') {
      sendEmailVerification({ to: email, token: verification.token })
        .catch((error) => console.error('[auth] Failed to resend verification email:', error));
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', authLimiter, async (req, res) => {
  const schema = z.object({
    email: z.string().email().toLowerCase()
  });

  try {
    const { email } = schema.parse(req.body || {});
    const db = getDatabase();
    const user = await db.collection('users').findOne({ email });

    if (user) {
      const reset = createPasswordResetToken();
      await db.collection('users').updateOne(
        { _id: user._id },
        {
          $set: {
            passwordResetTokenHash: reset.tokenHash,
            passwordResetTokenExpiresAt: reset.expiresAt,
            updatedAt: new Date()
          }
        }
      );

      if (process.env.MOCK_EMAILS !== 'true') {
        sendPasswordReset({ to: email, token: reset.token })
          .catch((error) => console.error('[auth] Failed to send password reset email:', error));
      }
    }

    res.json({ ok: true });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', authLimiter, async (req, res) => {
  const schema = z.object({
    token: z.string().min(1),
    password: passwordSchema
  });

  try {
    const { token, password } = schema.parse(req.body || {});
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const db = getDatabase();
    const now = new Date();

    const user = await db.collection('users').findOne({
      passwordResetTokenHash: tokenHash,
      passwordResetTokenExpiresAt: { $gt: now }
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const passwordHash = await hashPassword(password);
    await db.collection('users').updateOne(
      { _id: user._id },
      {
        $set: { passwordHash, updatedAt: new Date() },
        $unset: { passwordResetTokenHash: '', passwordResetTokenExpiresAt: '' }
      }
    );

    if (process.env.MOCK_EMAILS !== 'true') {
      sendPasswordChangeConfirmation({ to: user.email })
        .catch((error) => console.error('[auth] Failed to send password confirmation email:', error));
    }

    res.json({ ok: true });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, csrfProtection, async (req, res) => {
  const schema = z.object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema
  });

  try {
    const { currentPassword, newPassword } = schema.parse(req.body || {});
    const db = getDatabase();
    const { ObjectId } = await import('mongodb');

    const user = await db.collection('users').findOne({ _id: new ObjectId(req.user._id) });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isValid = await verifyPassword(user.passwordHash, currentPassword);
    if (!isValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const passwordHash = await hashPassword(newPassword);
    await db.collection('users').updateOne(
      { _id: user._id },
      { $set: { passwordHash, updatedAt: new Date() } }
    );

    if (process.env.MOCK_EMAILS !== 'true') {
      sendPasswordChangeConfirmation({ to: user.email })
        .catch((error) => console.error('[auth] Failed to send password confirmation email:', error));
    }

    res.json({ ok: true });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', csrfProtection, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Could not log out' });
    }
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out successfully' });
  });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.user) {
    return res.json({ user: null });
  }

  const user = {
    _id: req.user._id,
    email: req.user.email,
    firstName: req.user.firstName,
    lastName: req.user.lastName,
    emailVerifiedAt: req.user.emailVerifiedAt || null
  };
  res.json({ user });
});

// GET /api/auth/me/entitlements
router.get('/me/entitlements', requireAuth, async (req, res) => {
  try {
    const db = getDatabase();
    const { ObjectId } = await import('mongodb');
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    
    // Get latest user data (subscription status may have changed)
    let user = await db.collection('users').findOne(
      { _id: new ObjectId(req.user._id) },
      { projection: { passwordHash: 0 } }
    );
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Verify subscription with Stripe if user has subscription ID
    let hasActiveSubscription = false;
    let subscriptionStatus = user.subscriptionStatus || null;
    let subscriptionCurrentPeriodEnd = normalizeStoredPeriodEnd(user.subscriptionCurrentPeriodEnd);
    
    if (user.stripeSubscriptionId) {
      try {
        console.log('[entitlements] Verifying subscription with Stripe:', user.stripeSubscriptionId);
        const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
        
        // Compute period ends from Stripe and stored fallback
        const stripePeriodEnd = normalizeSubscriptionPeriodEnd(subscription);
        const storedPeriodEnd = normalizeStoredPeriodEnd(user.subscriptionCurrentPeriodEnd);

        // Update subscription info from Stripe
        subscriptionStatus = subscription.status;
        subscriptionCurrentPeriodEnd = stripePeriodEnd || storedPeriodEnd;
        
        // Active subscription with null periodEnd: compute a 1-year fallback
        if (subscription.status === 'active' && !subscriptionCurrentPeriodEnd) {
          subscriptionCurrentPeriodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
          console.warn('[entitlements] periodEnd null for active subscription, using 1-year fallback:', subscriptionCurrentPeriodEnd);
        }

        hasActiveSubscription =
          subscription.status === 'active' &&
          (!subscriptionCurrentPeriodEnd || subscriptionCurrentPeriodEnd > new Date());
        
        // Update user record with latest subscription info
        const update = {
          $set: {
            subscriptionStatus: subscriptionStatus,
            unlimited: hasActiveSubscription,
            updatedAt: new Date()
          }
        };
        // Only persist period end when Stripe gives a valid value; do not unset fallback
        if (stripePeriodEnd) {
          update.$set.subscriptionCurrentPeriodEnd = stripePeriodEnd;
        }
        await db.collection('users').updateOne(
          { _id: new ObjectId(req.user._id) },
          update
        );
        
        console.log('[entitlements] Subscription verified:', {
          status: subscriptionStatus,
          active: hasActiveSubscription,
          periodEnd: subscriptionCurrentPeriodEnd
        });
      } catch (stripeError) {
        console.error('[entitlements] Error verifying subscription with Stripe:', stripeError);
        // If Stripe error, fall back to local check
        const storedPeriodEnd = normalizeStoredPeriodEnd(user.subscriptionCurrentPeriodEnd);
        subscriptionCurrentPeriodEnd = storedPeriodEnd;
        hasActiveSubscription =
          user.subscriptionStatus === 'active' &&
          (!storedPeriodEnd || storedPeriodEnd > new Date());
      }
    } else {
      // No Stripe subscription ID, check local status
      const storedPeriodEnd = normalizeStoredPeriodEnd(user.subscriptionCurrentPeriodEnd);
      subscriptionCurrentPeriodEnd = storedPeriodEnd;
      hasActiveSubscription =
        user.subscriptionStatus === 'active' &&
        (!storedPeriodEnd || storedPeriodEnd > new Date());
    }
    
    // Get one-time purchases that are not expired
    const now = new Date();
    const validPurchases = await db.collection('purchases')
      .find({
        userId: new ObjectId(req.user._id),
        product: 'single',
        $or: [
          { expiresAt: { $gt: now } },
          { expiresAt: { $exists: false } }, // Legacy purchases without expiresAt
          { 
            // Check purchaseDate or createdAt
            $expr: {
              $lt: [
                { $divide: [{ $subtract: [now, { $ifNull: ['$purchaseDate', '$createdAt'] }] }, 86400000] },
                365
              ]
            }
          }
        ]
      })
      .sort({ createdAt: -1 })
      .toArray();
    
    // Compute moon calendar entitlements (standalone purchases)
    const moonPurchases = await db.collection('purchases')
      .find({
        userId: new ObjectId(req.user._id),
        product: 'moon'
      })
      .toArray();
    let moonStandaloneAllowed = false;
    let moonStandaloneStart = null;
    let moonStandaloneEnd = null;

    for (const p of moonPurchases) {
      const purchaseDate = p.purchaseDate || p.createdAt;
      if (!purchaseDate) continue;

      const entitlementEnd = p.entitlementEnd || (() => {
        const d = new Date(purchaseDate);
        const year = d.getUTCFullYear() + 1;
        const month = d.getUTCMonth();
        const day = d.getUTCDate();
        return new Date(Date.UTC(year, month, day));
      })();

      if (entitlementEnd >= now) {
        moonStandaloneAllowed = true;
        if (!moonStandaloneStart || purchaseDate < moonStandaloneStart) {
          moonStandaloneStart = purchaseDate;
        }
        if (!moonStandaloneEnd || entitlementEnd > moonStandaloneEnd) {
          moonStandaloneEnd = entitlementEnd;
        }
      }
    }

    // Derive overall moon calendar entitlement combining Pro + standalone
    const proMoonAllowed = hasActiveSubscription && !!subscriptionCurrentPeriodEnd;
    const proMoonEnd = subscriptionCurrentPeriodEnd || null;

    const moonAllowed = proMoonAllowed || moonStandaloneAllowed;
    let moonStartDate = null;
    let moonEndDate = null;

    if (moonAllowed) {
      if (proMoonAllowed) {
        moonStartDate = now;
      } else if (moonStandaloneAllowed) {
        moonStartDate = moonStandaloneStart;
      }

      const candidates = [proMoonEnd, moonStandaloneEnd].filter(Boolean);
      if (candidates.length > 0) {
        moonEndDate = new Date(Math.max(...candidates.map(d => d.getTime())));
      }
    }

    const entitlements = {
      unlimited: hasActiveSubscription,
      unlimitedSince: user.unlimitedSince || null,
      subscriptionStatus: subscriptionStatus,
      subscriptionCurrentPeriodEnd: subscriptionCurrentPeriodEnd,
      oneTimePurchases: validPurchases.map(p => ({
        _id: p._id,
        purchaseDate: p.purchaseDate || p.createdAt,
        expiresAt: p.expiresAt || new Date(new Date(p.purchaseDate || p.createdAt).getTime() + 365 * 24 * 60 * 60 * 1000),
        stationTitle: p.regenerationParams?.stationTitle || p.metadata?.stationTitle,
        country: p.regenerationParams?.country || p.metadata?.country,
        stationId: p.regenerationParams?.stationId || p.metadata?.stationId
      })),
      moonCalendar: {
        allowed: moonAllowed,
        startDate: moonStartDate,
        endDate: moonEndDate,
        sources: {
          pro: proMoonAllowed,
          standalone: moonStandaloneAllowed
        }
      }
    };
    
    res.json(entitlements);
  } catch (error) {
    console.error('Error fetching entitlements:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me/purchases
router.get('/me/purchases', requireAuth, async (req, res) => {
  try {
    const db = getDatabase();
    const { ObjectId } = await import('mongodb');
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    
    const purchases = await db.collection('purchases')
      .find({ userId: new ObjectId(req.user._id) })
      .sort({ createdAt: -1 })
      .project({
        userId: 0 // Don't include userId in response
      })
      .toArray();
    
    // Add expiration status and days remaining for one-time purchases
    const now = new Date();
    const purchasesWithStatus = await Promise.all(purchases.map(async (p) => {
      const result = { ...p };
      
      if (p.product === 'single') {
        const purchaseDate = p.purchaseDate || p.createdAt;
        const expiresAt = p.expiresAt || new Date(new Date(purchaseDate).getTime() + 365 * 24 * 60 * 60 * 1000);
        const daysRemaining = Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)));
        const isExpired = expiresAt < now;

        result.isExpired = isExpired;
        result.daysRemaining = daysRemaining;
        result.expiresAt = expiresAt;

        // Ensure station info is present for account display
        const existingCountry = result.regenerationParams?.country || result.metadata?.country;
        const existingStationId =
          result.regenerationParams?.stationId ||
          result.metadata?.stationId ||
          result.metadata?.stationID;
        let existingStationTitle =
          result.regenerationParams?.stationTitle ||
          result.metadata?.stationTitle ||
          null;

        if ((!existingStationTitle || existingStationTitle === 'Tide Station') && existingCountry && existingStationId) {
          existingStationTitle = resolveStationTitle(existingCountry, existingStationId) || existingStationTitle;
        }

        if (!result.regenerationParams) {
          result.regenerationParams = {};
        }
        if (existingCountry) result.regenerationParams.country = existingCountry;
        if (existingStationId) result.regenerationParams.stationId = existingStationId;
        if (existingStationTitle) result.regenerationParams.stationTitle = existingStationTitle;
      } else if (p.product === 'golden') {
        const purchaseDate = p.purchaseDate || p.createdAt;
        const expiresAt = p.expiresAt || new Date(new Date(purchaseDate).getTime() + 365 * 24 * 60 * 60 * 1000);
        const daysRemaining = Math.max(0, Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)));
        const isExpired = expiresAt < now;
        result.isExpired = isExpired;
        result.daysRemaining = daysRemaining;
        result.expiresAt = expiresAt;
        if (!result.regenerationParams && p.regenerationParams) {
          result.regenerationParams = { ...p.regenerationParams };
        }
      } else if (p.product === 'subscription') {
        // For subscriptions, verify with Stripe
        let periodEnd = normalizeStoredPeriodEnd(p.subscriptionCurrentPeriodEnd);
        let isActive = false;
        
        if (p.stripeSubscriptionId) {
          try {
            console.log('[purchases] Verifying subscription purchase with Stripe:', p.stripeSubscriptionId);
            const subscription = await stripe.subscriptions.retrieve(p.stripeSubscriptionId);
            const stripePeriodEnd = normalizeSubscriptionPeriodEnd(subscription);
            const storedPeriodEnd = normalizeStoredPeriodEnd(p.subscriptionCurrentPeriodEnd);
            periodEnd = stripePeriodEnd || storedPeriodEnd;
            isActive = subscription.status === 'active' && periodEnd && periodEnd > now;
            
            // Update purchase record with latest info
            const update = {
              $set: {
                subscriptionStatus: subscription.status,
                updatedAt: new Date()
              }
            };
            if (stripePeriodEnd) {
              update.$set.subscriptionCurrentPeriodEnd = stripePeriodEnd;
            }
            await db.collection('purchases').updateOne(
              { _id: p._id },
              update
            );
          } catch (stripeError) {
            console.error('[purchases] Error verifying subscription with Stripe:', stripeError);
            // Fall back to stored value
            isActive = periodEnd && periodEnd > now;
          }
        } else {
          // No Stripe ID, use stored value
          isActive = periodEnd && periodEnd > now;
        }
        
        result.isActive = isActive;
        result.currentPeriodEnd = periodEnd;
      }
      
      return result;
    }));

    // Exclude legacy subscription marker rows that have no period end and are not active.
    // These appear as: product: 'subscription', currentPeriodEnd: null, isActive: null/false.
    const filtered = purchasesWithStatus.filter((p) => {
      if (p.product !== 'subscription') return true;
      if (p.currentPeriodEnd) return true;
      if (p.isActive) return true;
      // p.product === 'subscription' && !p.currentPeriodEnd && !p.isActive → exclude
      return false;
    });

    res.json({ purchases: filtered });
  } catch (error) {
    console.error('Error fetching purchases:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me/subscription-downloads
router.get('/me/subscription-downloads', requireAuth, async (req, res) => {
  try {
    const db = getDatabase();
    const { ObjectId } = await import('mongodb');
    
    const downloads = await db.collection('subscription_downloads')
      .find({ userId: new ObjectId(req.user._id) })
      .sort({ updatedAt: -1 })
      .project({ userId: 0 })
      .toArray();
    
    res.json({ downloads });
  } catch (error) {
    console.error('Error fetching subscription downloads:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
