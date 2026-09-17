import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { promises as dns } from 'dns';
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
import { normalizeEmail } from '../auth/normalizeEmail.js';
import { hasProSubscriptionFullyRefundedPurchase, purchaseNotFullyRefundedFilter } from '../services/refund/purchaseRefundHelpers.js';
import { 
  sendEmailVerification,
  sendPasswordReset,
  sendPasswordChangeConfirmation
} from '../auth/email.js';
import { z } from 'zod';
import {
  readAttributionFromRequest,
  reconcileUserAcquisition,
  sanitizeAcquisitionRecord,
} from '../attribution/index.js';
import { recordSignupCompleted } from '../funnel/index.js';

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

// Rate-limit handler shared by all auth limiters
const rateLimitHandler = (_req, res) => {
  res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
};

// Login: brute-force protection by IP (10 / 15 min). Bad credentials still 401,
// so honest users hitting an empty cache won't usually hit this.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  handler: rateLimitHandler,
});

// Signup: tight by IP because every successful signup triggers a verification
// email. Bombing attacks rotate IPs so this is not the only defense (see
// honeypot, time-trap, MX check, and normalized-email uniqueness below).
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  handler: rateLimitHandler,
});

// Reset-password (the *token redemption* endpoint, not the request endpoint):
// brute-force protection on the token. Per IP.
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  handler: rateLimitHandler,
});

// Forgot-password by IP — same network can't blast many addresses.
const forgotPasswordIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  handler: rateLimitHandler,
});

// Forgot-password by NORMALIZED email — the most important limiter for the
// reset-email bombing pattern. Caps reset emails to any one inbox even when
// the attacker rotates IPs and dot-trick variants. Falls back to the request
// IP if no email is provided (so a bad body still gets rate-limited).
const forgotPasswordEmailLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  limit: 3,
  keyGenerator: (req) => {
    const normalized = normalizeEmail(req.body?.email || '');
    return normalized || `ip:${ipKeyGenerator(req.ip)}`;
  },
  handler: rateLimitHandler,
});

// Resend-verification by IP and by normalized email — analogous to the
// forgot-password pair. Without this, a bot can repeatedly hit /resend-verification
// for an account it just created to bomb the inbox.
const resendVerificationIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  handler: rateLimitHandler,
});

const resendVerificationEmailLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  limit: 3,
  keyGenerator: (req) => {
    const candidate = req.body?.email || req.user?.email || '';
    const normalized = normalizeEmail(candidate);
    return normalized || `ip:${ipKeyGenerator(req.ip)}`;
  },
  handler: rateLimitHandler,
});

// How long after signup we suppress an automatic re-verification email for an
// idempotent re-signup against an existing unverified account. Long enough
// that a bot replay doesn't trigger another send; short enough that a real
// user who didn't get the first email can still resend via the modal.
const RESEND_VERIFICATION_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

// Minimum age of the signup form before we accept a submission (defeats most
// scripted bots that POST instantly without rendering the page). Real users
// take far longer than this just to type an email + password.
const SIGNUP_MIN_FORM_AGE_MS = 1500;

// MX cache so we don't re-query DNS for popular domains (gmail.com, etc.).
// Entries live for 1 hour. Failures cached for 5 minutes so a flaky DNS
// blip doesn't lock out legitimate signups for long.
const mxCache = new Map();
const MX_CACHE_OK_MS = 60 * 60 * 1000;
const MX_CACHE_FAIL_MS = 5 * 60 * 1000;

async function domainHasMx(domain) {
  if (!domain) return false;
  const cached = mxCache.get(domain);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.ok;
  }
  try {
    const records = await dns.resolveMx(domain);
    const ok = Array.isArray(records) && records.length > 0;
    mxCache.set(domain, { ok, expiresAt: now + (ok ? MX_CACHE_OK_MS : MX_CACHE_FAIL_MS) });
    return ok;
  } catch (err) {
    // ENOTFOUND / ENODATA / SERVFAIL etc. all mean "can't deliver mail here".
    mxCache.set(domain, { ok: false, expiresAt: now + MX_CACHE_FAIL_MS });
    return false;
  }
}

// Apply attachUser to all auth routes
router.use(attachUser);

// GET /api/auth/signup-form-token
// Issues a short-lived signed timestamp that the signup form must POST back.
// Used as a server-side time-trap: if the form is submitted faster than
// SIGNUP_MIN_FORM_AGE_MS, it's almost certainly a bot.
router.get('/signup-form-token', (req, res) => {
  if (!req.session) {
    return res.status(500).json({ error: 'Session unavailable' });
  }
  req.session.signupFormIssuedAt = Date.now();
  res.json({ issuedAt: req.session.signupFormIssuedAt });
});

// POST /api/auth/signup
//
// Hardened against the bombing pattern seen in production: bots create real
// accounts using dot-trick Gmail variants of one victim's address, then trigger
// verification + reset emails to bomb that inbox. Defenses (in order):
//
//   1. Honeypot field (`company`): a hidden input real users never see. If it's
//      filled in, the request is silently accepted with a fake success shape so
//      the bot can't tell it was caught. No DB write, no email.
//   2. Time-trap: the client must request /signup-form-token first and submit
//      back the issuedAt. Submissions faster than SIGNUP_MIN_FORM_AGE_MS are
//      treated like honeypot hits (silent fake success).
//   3. MX check: the email's domain must have at least one MX record.
//   4. Email normalization: uniqueness is checked against `normalizedEmail`,
//      not the raw email, so dot/plus variants collapse to one account.
//   5. Idempotent response: existing-account signups return the same 201 shape
//      as a brand-new signup so the form can't be used as an enumeration oracle.
//      A new verification email is only sent if the existing account is still
//      unverified AND the last one was sent more than RESEND_VERIFICATION_COOLDOWN_MS ago.
router.post('/signup', signupLimiter, async (req, res) => {
  // Generic success shape used for honeypot/time-trap rejections and for the
  // idempotent "already exists" case. Deliberately reveals nothing.
  const fakeSuccess = () => res.status(201).json({
    user: null,
    verificationSent: true
  });

  try {
    // (1) Honeypot
    if (req.body && typeof req.body.company === 'string' && req.body.company.trim() !== '') {
      console.warn('[auth] Signup honeypot tripped from IP', req.ip);
      return fakeSuccess();
    }

    // (2) Time-trap. We accept either the session-stored issuedAt (set by
    // GET /signup-form-token) or a body-supplied issuedAt as a fallback for
    // older clients; the session-stored value wins if both are present.
    const sessionIssuedAt = Number(req.session?.signupFormIssuedAt) || 0;
    const bodyIssuedAt = Number(req.body?.formIssuedAt) || 0;
    const issuedAt = sessionIssuedAt || bodyIssuedAt;
    if (!issuedAt || Date.now() - issuedAt < SIGNUP_MIN_FORM_AGE_MS) {
      console.warn('[auth] Signup time-trap tripped from IP', req.ip, '(form age:', Date.now() - issuedAt, 'ms)');
      return fakeSuccess();
    }
    // One-shot: clear the issuedAt so the same token can't be reused.
    if (req.session) {
      req.session.signupFormIssuedAt = null;
    }

    const validated = signupSchema.parse(req.body);
    const { email, password, firstName, lastName } = validated;
    const normalizedEmail = normalizeEmail(email);
    const [, domain] = email.split('@');

    // (3) MX check
    const mxOk = await domainHasMx(domain);
    if (!mxOk) {
      return res.status(400).json({
        error: 'That email domain doesn\'t look reachable. Please use a different email.'
      });
    }

    const db = getDatabase();

    // (4 + 5) Existing account check — by normalized email so dot/plus variants
    // collapse to one record. We deliberately return the same success shape
    // either way (idempotent / non-enumerating). If the existing account is
    // unverified and hasn't had a verification email recently, we re-send.
    const existingUser = await db.collection('users').findOne({
      $or: [
        { normalizedEmail },
        { email } // backstop until backfill is run
      ]
    });

    if (existingUser) {
      const lastIssued = existingUser.emailVerificationTokenExpiresAt
        ? new Date(existingUser.emailVerificationTokenExpiresAt).getTime() - EMAIL_VERIFICATION_TTL_MS
        : 0;
      const shouldResend =
        !existingUser.emailVerifiedAt &&
        Date.now() - lastIssued > RESEND_VERIFICATION_COOLDOWN_MS;

      if (shouldResend) {
        const verification = createEmailVerificationToken();
        await db.collection('users').updateOne(
          { _id: existingUser._id },
          {
            $set: {
              emailVerificationTokenHash: verification.tokenHash,
              emailVerificationTokenExpiresAt: verification.expiresAt,
              updatedAt: new Date()
            }
          }
        );
        if (process.env.MOCK_EMAILS !== 'true') {
          sendEmailVerification({ to: existingUser.email, token: verification.token })
            .catch((error) => console.error('[auth] Failed to send verification email:', error));
        }
      }

      // DO NOT log the existing user in — that would let a bot hijack a session
      // for any address whose owner happens to have an account. The legitimate
      // user can log in normally with their real password.
      return fakeSuccess();
    }

    const passwordHash = await hashPassword(password);
    const now = new Date();
    const verification = createEmailVerificationToken();
    const cookieAttribution = sanitizeAcquisitionRecord(readAttributionFromRequest(req));

    const result = await db.collection('users').insertOne({
      email,
      normalizedEmail,
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
      isTest: false,
      ...(cookieAttribution ? { acquisition: cookieAttribution } : {}),
      createdAt: now,
      updatedAt: now
    });

    req.session.userId = result.insertedId;

    if (cookieAttribution?.journeyId) {
      try {
        await recordSignupCompleted({
          db,
          acquisition: cookieAttribution,
          createdUserId: result.insertedId,
          isTest: false,
        });
      } catch (eventError) {
        console.warn('[funnel] signup event not recorded:', eventError?.message || eventError);
      }
    }

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
    // Unique-index collision on normalizedEmail in the race between our findOne
    // and insertOne: return the same idempotent fake success.
    if (error?.code === 11000) {
      return res.status(201).json({ user: null, verificationSent: true });
    }
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const validated = loginSchema.parse(req.body);
    const { email, password } = validated;
    const normalizedEmail = normalizeEmail(email);

    const db = getDatabase();

    // Look up by exact email first (covers historical rows and the common case)
    // then by normalizedEmail (covers users whose stored canonical form differs
    // from what they just typed — e.g. they signed up as "a.lice@gmail" and now
    // typed "alice@gmail").
    const user =
      (await db.collection('users').findOne({ email })) ||
      (normalizedEmail
        ? await db.collection('users').findOne({ normalizedEmail })
        : null);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Verify password
    const isValidPassword = await verifyPassword(user.passwordHash, password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Preserve first touch; update last touch from valid current cookie
    const cookieAttribution = sanitizeAcquisitionRecord(readAttributionFromRequest(req));
    if (cookieAttribution) {
      const nextAcquisition = reconcileUserAcquisition(user.acquisition, cookieAttribution);
      if (nextAcquisition) {
        await db.collection('users').updateOne(
          { _id: user._id },
          { $set: { acquisition: nextAcquisition, updatedAt: new Date() } }
        );
      }
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
//
// Rate-limited by both IP and normalized email so the bombing pattern
// (many requests targeting the same canonical inbox via dot/plus variants)
// is capped at 3 emails / 24h per inbox.
router.post(
  '/resend-verification',
  resendVerificationIpLimiter,
  resendVerificationEmailLimiter,
  async (req, res) => {
  try {
    const email = (req.body?.email || req.user?.email || '').toString().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    const normalizedEmail = normalizeEmail(email);

    const db = getDatabase();
    const user =
      (await db.collection('users').findOne({ email })) ||
      (normalizedEmail
        ? await db.collection('users').findOne({ normalizedEmail })
        : null);

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
      sendEmailVerification({ to: user.email, token: verification.token })
        .catch((error) => console.error('[auth] Failed to resend verification email:', error));
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/forgot-password
//
// Two-layer rate limit: per-IP (5/h) and per normalized email (3/24h).
// The per-email layer is what stops the "3 resets in a row to the same
// inbox" pattern even when the attacker rotates IPs.
//
// Also: we only send a reset email if the account is verified. Bombing
// campaigns sign up fake accounts and immediately trigger resets; those
// accounts are never verified, so this single rule breaks the chain.
router.post(
  '/forgot-password',
  forgotPasswordIpLimiter,
  forgotPasswordEmailLimiter,
  async (req, res) => {
  const schema = z.object({
    email: z.string().email().toLowerCase()
  });

  try {
    const { email } = schema.parse(req.body || {});
    const normalizedEmail = normalizeEmail(email);
    const db = getDatabase();
    const user =
      (await db.collection('users').findOne({ email })) ||
      (normalizedEmail
        ? await db.collection('users').findOne({ normalizedEmail })
        : null);

    // Three suppressed cases that ALL look identical to the client (the
    // response is `{ ok: true }` regardless, to preserve non-enumeration):
    //   - no account                  → nothing to reset
    //   - account exists but not yet verified → bot/abuse pattern
    //   - account exists, verified, in rate-limit window → user must wait
    //
    // Only the case below this guard actually sends mail.
    if (user && user.emailVerifiedAt) {
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
        sendPasswordReset({ to: user.email, token: reset.token })
          .catch((error) => console.error('[auth] Failed to send password reset email:', error));
      }
    } else if (user && !user.emailVerifiedAt) {
      console.warn('[auth] Suppressed password reset for unverified account', { userId: user._id });
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
router.post('/reset-password', resetPasswordLimiter, async (req, res) => {
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

        const proRefunded = await hasProSubscriptionFullyRefundedPurchase(
          req.user._id,
          user.stripeSubscriptionId
        );
        if (proRefunded) {
          hasActiveSubscription = false;
        }

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
        const proRefundedCatch = await hasProSubscriptionFullyRefundedPurchase(
          req.user._id,
          user.stripeSubscriptionId
        );
        if (proRefundedCatch) {
          hasActiveSubscription = false;
        }
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
        $and: [
          purchaseNotFullyRefundedFilter,
          {
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
          }
        ]
      })
      .sort({ createdAt: -1 })
      .toArray();
    
    // Compute moon calendar entitlements (standalone purchases)
    const moonPurchases = await db.collection('purchases')
      .find({
        userId: new ObjectId(req.user._id),
        product: 'moon',
        $and: [purchaseNotFullyRefundedFilter]
      })
      .toArray();
    let moonStandaloneAllowed = false;
    let moonStandaloneStart = null;
    let moonStandaloneEnd = null;

    for (const p of moonPurchases) {
      if (p.fullyRefundedAt) continue;
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
