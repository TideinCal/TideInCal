/**
 * Capture sanitized first-party UTM attribution on the initial request
 * BEFORE express.static. Does not require sessions or MongoDB.
 */
import {
  attributionTouchFromQuery,
  buildSetCookieHeader,
  getAttributionCookieSecret,
  mergeAttributionRecord,
  parseAttributionCookie,
  readAttributionFromRequest,
  sanitizeLandingPath,
  serializeAttributionCookie,
} from '../attribution/index.js';
import { getDatabase } from '../db/index.js';
import { landingDedupeKey, recordFunnelEvent } from '../funnel/index.js';

/**
 * Testable capture core. A tagged request writes the cookie and exactly one
 * retry-safe landing event; an untagged request performs neither write.
 */
export async function captureAttributionRequest({
  req,
  res,
  db,
  secret = getAttributionCookieSecret(),
  now = new Date(),
}) {
  const existing = readAttributionFromRequest(req, secret);

  const landingPath = sanitizeLandingPath(req.path || '/') || '/';
  const incoming = attributionTouchFromQuery(req.query || {}, landingPath, now);

  if (!incoming) {
    req.attribution = existing;
    return { tagged: false, attribution: existing };
  }

  const merged = mergeAttributionRecord(existing, incoming);
  const signed = serializeAttributionCookie(merged, secret);
  if (signed) {
    res.append('Set-Cookie', buildSetCookieHeader(signed));
  }
  req.attribution = merged;
  const eventDb = typeof db === 'function' ? db() : db;
  await recordFunnelEvent({
    db: eventDb,
    eventName: 'tagged_landing',
    acquisition: merged,
    landingPath: incoming.landingPath,
    dedupeKey: landingDedupeKey(merged),
    now,
  });
  return { tagged: true, attribution: merged };
}

/** Express middleware: capture first-party attribution without blocking use on failure. */
export async function captureAttribution(req, res, next) {
  try {
    await captureAttributionRequest({ req, res, db: getDatabase });
  } catch (err) {
    // Malformed cookies or measurement failures must not break the landing page.
    console.warn('[attribution] capture skipped:', err?.message || err);
    if (!req.attribution) req.attribution = null;
  }
  return next();
}

export { parseAttributionCookie, readAttributionFromRequest };
