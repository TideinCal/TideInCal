import { ObjectId } from 'mongodb';
import crypto from 'crypto';
import {
  compactAttributionFromAcquisition,
  normalizeIsTest,
  sanitizeJourneyId,
  sanitizeLandingPath,
  UNKNOWN,
} from '../attribution/index.js';

export const FUNNEL_EVENTS = Object.freeze([
  'tagged_landing',
  'product_selected',
  'signup_completed',
  'checkout_started',
  'purchase_completed',
]);

export const PRODUCT_TYPES = Object.freeze([
  'single',
  'golden',
  'tide_and_golden',
  'subscription',
]);

export const VERIFICATION_IDENTIFIERS = Object.freeze([
  'tidy_measurement_verification',
  'cookie_only',
]);

const ANONYMOUS_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export function normalizeProductType(value) {
  if (value === 'tide') return 'single';
  return PRODUCT_TYPES.includes(value) ? value : null;
}

export function normalizeStationCountry(value) {
  if (typeof value !== 'string') return UNKNOWN;
  const normalized = value.trim().toLowerCase();
  return normalized === 'canada' || normalized === 'usa' ? normalized : UNKNOWN;
}

function duplicateKey(error) {
  return error?.code === 11000;
}

/**
 * Persist one allowlisted, purpose-limited funnel event. Callers supply only
 * server-derived context; this function never accepts free-form analytics data.
 */
export async function recordFunnelEvent({
  db,
  eventName,
  acquisition,
  productType,
  stationCountry,
  userId,
  isTest,
  dedupeKey,
  landingPath,
  now = new Date(),
}) {
  if (!FUNNEL_EVENTS.includes(eventName)) {
    throw new TypeError('Unknown funnel event');
  }

  const journeyId = sanitizeJourneyId(acquisition?.journeyId);
  if (!journeyId) return { recorded: false, reason: 'no_valid_journey' };
  if (typeof dedupeKey !== 'string' || dedupeKey.length < 1 || dedupeKey.length > 240) {
    throw new TypeError('Invalid funnel event dedupe key');
  }

  const attribution = compactAttributionFromAcquisition(acquisition);
  const product = productType == null ? null : normalizeProductType(productType);
  if (productType != null && !product) throw new TypeError('Invalid product type');

  const authenticatedUserId = userId == null
    ? null
    : userId instanceof ObjectId ? userId : new ObjectId(userId);

  const event = {
    eventName,
    journeyId,
    source: attribution.source,
    medium: attribution.medium,
    campaign: attribution.campaign,
    content: attribution.content,
    landingPath: sanitizeLandingPath(landingPath) ||
      sanitizeLandingPath(acquisition?.firstTouch?.landingPath) || UNKNOWN,
    serverTimestamp: now,
    dedupeKey,
    // dedupeKey is retained solely for the unique retry guard. expiresAt is
    // retained solely for MongoDB's anonymous-event TTL index.
    ...(product ? { productType: product, stationCountry: normalizeStationCountry(stationCountry) } : {}),
    ...(authenticatedUserId ? { userId: authenticatedUserId } : {
      expiresAt: new Date(now.getTime() + ANONYMOUS_TTL_MS),
    }),
    ...(isTest == null ? {} : { isTest: normalizeIsTest(isTest) }),
  };

  try {
    await db.collection('funnel_events').insertOne(event);
    return { recorded: true, event };
  } catch (error) {
    if (duplicateKey(error)) return { recorded: false, reason: 'duplicate' };
    throw error;
  }
}

export async function recordSignupCompleted({ db, acquisition, createdUserId, isTest = false }) {
  if (!createdUserId) return { recorded: false, reason: 'user_not_created' };
  return recordFunnelEvent({
    db,
    eventName: 'signup_completed',
    acquisition,
    userId: createdUserId,
    isTest,
    dedupeKey: `${acquisition?.journeyId}:signup`,
  });
}

export function landingDedupeKey(acquisition) {
  const a = compactAttributionFromAcquisition(acquisition);
  return `${acquisition.journeyId}:${a.campaign}:${a.content}`;
}

export function productDedupeKey(acquisition, productType) {
  return `${acquisition.journeyId}:${normalizeProductType(productType)}`;
}

/** Deterministic guard derived from the Stripe Session ID without storing it raw. */
export function checkoutSessionDedupeKey(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('Invalid Checkout Session ID');
  return `checkout:${crypto.createHash('sha256').update(sessionId).digest('hex')}`;
}

export function productTypeFromCheckout({ plan, productType, goldenOnly, includeGoldenHour } = {}) {
  if (plan === 'unlimited' || plan === 'subscription') return 'subscription';
  if (goldenOnly || productType === 'golden') return 'golden';
  if (includeGoldenHour || productType === 'tide_and_golden') return 'tide_and_golden';
  return 'single';
}
