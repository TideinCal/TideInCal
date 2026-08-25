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

/**
 * Express middleware: read/update signed attribution cookie from UTM query params.
 */
export function captureAttribution(req, res, next) {
  try {
    const secret = getAttributionCookieSecret();
    const existing = readAttributionFromRequest(req, secret);

    const landingPath = sanitizeLandingPath(req.path || '/') || '/';
    const incoming = attributionTouchFromQuery(req.query || {}, landingPath);

    if (!incoming) {
      // Untagged visit must not overwrite existing attribution with direct
      req.attribution = existing;
      return next();
    }

    const merged = mergeAttributionRecord(existing, incoming);
    const signed = serializeAttributionCookie(merged, secret);
    if (signed) {
      res.append('Set-Cookie', buildSetCookieHeader(signed));
    }
    req.attribution = merged;
  } catch (err) {
    // Malformed cookie / secret issues must not break the landing page
    console.warn('[attribution] capture skipped:', err?.message || err);
    req.attribution = null;
  }
  return next();
}

export { parseAttributionCookie, readAttributionFromRequest };
