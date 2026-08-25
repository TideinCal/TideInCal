/**
 * Canonical first-party attribution validator and serializer.
 * No PII: only allowlisted UTM fields, same-site landing paths, and server timestamps.
 */
import crypto from 'crypto';

export const ATTRIBUTION_COOKIE_NAME = 'tic_attr';
export const ATTRIBUTION_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SLUG_MAX_LENGTH = 80;
export const UNKNOWN = 'unknown';

export const ALLOWED_SOURCES = Object.freeze([
  'instagram',
  'facebook',
  'linkedin',
  'email',
  'google',
  'referral',
  'direct',
]);

export const ALLOWED_MEDIUMS = Object.freeze([
  'organic_social',
  'email',
  'referral',
  'paid_social',
  'cpc',
]);

const SLUG_RE = /^[a-z0-9_-]+$/;
const FALLBACK_SECRET = 'fallback-secret-change-in-production';

/**
 * Attribution cookie secret: dedicated env, else SESSION_SECRET.
 * Production must not use the insecure hard-coded fallback.
 */
export function getAttributionCookieSecret() {
  const dedicated = (process.env.ATTRIBUTION_COOKIE_SECRET || '').trim();
  const session = (process.env.SESSION_SECRET || '').trim();
  const secret = dedicated || session;

  if (process.env.NODE_ENV === 'production') {
    if (!secret || secret === FALLBACK_SECRET) {
      throw new Error(
        'ATTRIBUTION_COOKIE_SECRET or SESSION_SECRET must be set to a secure value in production. Do not use the fallback.'
      );
    }
  }

  return secret || FALLBACK_SECRET;
}

export function normalizeIsTest(value) {
  return value === true || value === 'true';
}

function lowerTrim(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed === '' ? null : trimmed;
}

/**
 * Campaign/content: lowercase letters, numbers, underscores, hyphens; max length.
 * Rejects free-form / PII-like values.
 */
export function sanitizeSlug(value) {
  const v = lowerTrim(value);
  if (!v) return null;
  if (v.length > SLUG_MAX_LENGTH) return null;
  if (!SLUG_RE.test(v)) return null;
  return v;
}

export function sanitizeSource(value) {
  const v = lowerTrim(value);
  if (!v) return null;
  return ALLOWED_SOURCES.includes(v) ? v : null;
}

export function sanitizeMedium(value) {
  const v = lowerTrim(value);
  if (!v) return null;
  return ALLOWED_MEDIUMS.includes(v) ? v : null;
}

/**
 * Same-site path only — not a full URL or free-form referrer.
 */
export function sanitizeLandingPath(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  let path = value.trim();
  if (!path) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  if (path.includes('://') || path.includes('\\')) return null;
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  // Strip query/hash if present; path only
  const q = path.indexOf('?');
  if (q >= 0) path = path.slice(0, q);
  const h = path.indexOf('#');
  if (h >= 0) path = path.slice(0, h);
  if (path.length > 200) return null;
  if (!/^\/[A-Za-z0-9/_\-.]*$/.test(path)) return null;
  return path;
}

function toIsoTimestamp(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

/**
 * Build a single touch from sanitized fields. Returns null if nothing valid.
 */
export function buildTouch({
  source,
  medium,
  campaign,
  content,
  landingPath,
  firstSeenAt,
  lastSeenAt,
} = {}) {
  const touch = {};
  const s = sanitizeSource(source);
  const m = sanitizeMedium(medium);
  const c = sanitizeSlug(campaign);
  const ct = sanitizeSlug(content);
  const lp = sanitizeLandingPath(landingPath);

  if (s) touch.source = s;
  if (m) touch.medium = m;
  if (c) touch.campaign = c;
  if (ct) touch.content = ct;
  if (lp) touch.landingPath = lp;

  const fs = toIsoTimestamp(firstSeenAt);
  const ls = toIsoTimestamp(lastSeenAt);
  if (fs) touch.firstSeenAt = fs;
  if (ls) touch.lastSeenAt = ls;

  const hasUtm = !!(touch.source || touch.medium || touch.campaign || touch.content);
  if (!hasUtm) return null;
  return touch;
}

/**
 * Parse query-string UTMs. Only explicit utm_* parameters are accepted.
 * Requires at least one recognized UTM field. Timestamps are server-generated.
 */
export function attributionTouchFromQuery(query = {}, landingPath, now = new Date()) {
  const source = sanitizeSource(query.utm_source);
  const medium = sanitizeMedium(query.utm_medium);
  const campaign = sanitizeSlug(query.utm_campaign);
  const content = sanitizeSlug(query.utm_content);

  if (!source && !medium && !campaign && !content) {
    return null;
  }

  const iso = now.toISOString();
  return buildTouch({
    source,
    medium,
    campaign,
    content,
    landingPath,
    firstSeenAt: iso,
    lastSeenAt: iso,
  });
}

function touchForStorage(touch, { asFirst = false, asLast = false } = {}) {
  if (!touch) return null;
  const source = sanitizeSource(touch.source);
  const medium = sanitizeMedium(touch.medium);
  const campaign = sanitizeSlug(touch.campaign);
  const content = sanitizeSlug(touch.content);
  if (!source && !medium && !campaign && !content) return null;

  const out = {
    source: source || UNKNOWN,
    medium: medium || UNKNOWN,
    campaign: campaign || UNKNOWN,
    content: content || UNKNOWN,
    landingPath: sanitizeLandingPath(touch.landingPath) || UNKNOWN,
  };
  if (asFirst) {
    out.firstSeenAt =
      toIsoTimestamp(touch.firstSeenAt) ||
      toIsoTimestamp(touch.lastSeenAt) ||
      new Date().toISOString();
  }
  if (asLast) {
    out.lastSeenAt =
      toIsoTimestamp(touch.lastSeenAt) ||
      toIsoTimestamp(touch.firstSeenAt) ||
      new Date().toISOString();
  }
  return out;
}

/**
 * Merge cookie/user attribution: first touch stays fixed; last touch updates.
 * Untagged (null incoming) must not overwrite.
 */
export function mergeAttributionRecord(existing, incomingTouch) {
  if (!incomingTouch) {
    return existing || null;
  }

  const incomingFirst = touchForStorage(incomingTouch, { asFirst: true });
  const incomingLast = touchForStorage(incomingTouch, { asLast: true });

  if (!existing || !existing.firstTouch) {
    return {
      firstTouch: incomingFirst,
      lastTouch: incomingLast,
    };
  }

  return {
    firstTouch: existing.firstTouch,
    lastTouch: incomingLast,
  };
}

export function unknownAttribution() {
  return {
    source: UNKNOWN,
    medium: UNKNOWN,
    campaign: UNKNOWN,
    content: UNKNOWN,
    firstSeenAt: UNKNOWN,
    lastSeenAt: UNKNOWN,
  };
}

/** Prefer sanitized slug; allow explicit unknown through for Stripe round-trip. */
function slugOrUnknown(value) {
  if (value === UNKNOWN) return UNKNOWN;
  return sanitizeSlug(value) || UNKNOWN;
}

function sourceOrUnknown(value) {
  if (value === UNKNOWN) return UNKNOWN;
  return sanitizeSource(value) || UNKNOWN;
}

function mediumOrUnknown(value) {
  if (value === UNKNOWN) return UNKNOWN;
  return sanitizeMedium(value) || UNKNOWN;
}

function timestampOrUnknown(value) {
  if (value === UNKNOWN) return UNKNOWN;
  return toIsoTimestamp(value) || UNKNOWN;
}

/**
 * Compact purchase/Stripe attribution from an acquisition record
 * (last-touch UTM fields + first/last timestamps).
 */
export function compactAttributionFromAcquisition(acquisition) {
  if (!acquisition || (!acquisition.firstTouch && !acquisition.lastTouch)) {
    return unknownAttribution();
  }
  const first = acquisition.firstTouch || {};
  const last = acquisition.lastTouch || first;
  return {
    source: sourceOrUnknown(last.source),
    medium: mediumOrUnknown(last.medium),
    campaign: slugOrUnknown(last.campaign),
    content: slugOrUnknown(last.content),
    firstSeenAt: timestampOrUnknown(first.firstSeenAt),
    lastSeenAt: timestampOrUnknown(last.lastSeenAt),
  };
}

/**
 * Stripe metadata strings (all values must be strings).
 */
export function attributionToStripeMetadata(acquisition, isTest) {
  const a = compactAttributionFromAcquisition(acquisition);
  return {
    attribution_source: a.source,
    attribution_medium: a.medium,
    attribution_campaign: a.campaign,
    attribution_content: a.content,
    attribution_first_seen_at: a.firstSeenAt,
    attribution_last_seen_at: a.lastSeenAt,
    is_test: normalizeIsTest(isTest) ? 'true' : 'false',
  };
}

/**
 * Deserialize Stripe metadata safely. Absent/malformed → unknown + isTest false.
 */
export function attributionFromStripeMetadata(metadata = {}) {
  const attribution = {
    source: sourceOrUnknown(metadata.attribution_source),
    medium: mediumOrUnknown(metadata.attribution_medium),
    campaign: slugOrUnknown(metadata.attribution_campaign),
    content: slugOrUnknown(metadata.attribution_content),
    firstSeenAt: timestampOrUnknown(metadata.attribution_first_seen_at),
    lastSeenAt: timestampOrUnknown(metadata.attribution_last_seen_at),
  };

  // Conservative: only true when explicit string "true"; otherwise false
  const isTest = metadata.is_test === 'true';

  return { attribution, isTest };
}

function signPayload(payload, secret) {
  const body = Buffer.from(payload, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function unsignPayload(signed, secret) {
  if (!signed || typeof signed !== 'string') return null;
  const i = signed.lastIndexOf('.');
  if (i <= 0) return null;
  const body = signed.slice(0, i);
  const sig = signed.slice(i + 1);
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }
  try {
    return Buffer.from(body, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Validate a cookie/user acquisition object. Tampered fields discarded.
 */
export function sanitizeAcquisitionRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const firstRaw = record.firstTouch;
  const lastRaw = record.lastTouch;
  if (!firstRaw && !lastRaw) return null;

  const firstTouch = firstRaw ? touchForStorage(firstRaw, { asFirst: true }) : null;
  const lastTouch = lastRaw ? touchForStorage(lastRaw, { asLast: true }) : null;

  if (!firstTouch && !lastTouch) return null;
  return {
    firstTouch: firstTouch || lastTouch,
    lastTouch: lastTouch || firstTouch,
  };
}

export function serializeAttributionCookie(record, secret = getAttributionCookieSecret()) {
  const clean = sanitizeAcquisitionRecord(record);
  if (!clean) return null;
  return signPayload(JSON.stringify(clean), secret);
}

export function parseAttributionCookie(signedValue, secret = getAttributionCookieSecret()) {
  const json = unsignPayload(signedValue, secret);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return sanitizeAcquisitionRecord(parsed);
  } catch {
    return null;
  }
}

/**
 * Read attribution cookie from a raw Cookie header or Express req.
 */
export function readAttributionFromRequest(req, secret = getAttributionCookieSecret()) {
  const header = req?.headers?.cookie;
  if (!header || typeof header !== 'string') return null;
  const parts = header.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    if (name !== ATTRIBUTION_COOKIE_NAME) continue;
    const raw = decodeURIComponent(part.slice(idx + 1).trim());
    return parseAttributionCookie(raw, secret);
  }
  return null;
}

export function buildSetCookieHeader(signedValue, {
  maxAgeMs = ATTRIBUTION_COOKIE_MAX_AGE_MS,
  secure = process.env.NODE_ENV === 'production',
} = {}) {
  const maxAgeSec = Math.floor(maxAgeMs / 1000);
  const parts = [
    `${ATTRIBUTION_COOKIE_NAME}=${encodeURIComponent(signedValue)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Reconcile durable user.acquisition with current cookie: preserve first, update last.
 */
export function reconcileUserAcquisition(existingAcquisition, cookieRecord) {
  const existing = sanitizeAcquisitionRecord(existingAcquisition);
  if (!cookieRecord) return existing;
  const incoming = cookieRecord.lastTouch || cookieRecord.firstTouch;
  if (!incoming) return existing;
  return mergeAttributionRecord(existing, {
    source: incoming.source,
    medium: incoming.medium,
    campaign: incoming.campaign,
    content: incoming.content,
    landingPath: incoming.landingPath,
    firstSeenAt: incoming.firstSeenAt || incoming.lastSeenAt,
    lastSeenAt: incoming.lastSeenAt || incoming.firstSeenAt,
  });
}
