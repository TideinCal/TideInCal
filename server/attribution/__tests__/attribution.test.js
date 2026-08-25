import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ALLOWED_MEDIUMS,
  ALLOWED_SOURCES,
  UNKNOWN,
  attributionFromStripeMetadata,
  attributionToStripeMetadata,
  attributionTouchFromQuery,
  buildSetCookieHeader,
  compactAttributionFromAcquisition,
  getAttributionCookieSecret,
  mergeAttributionRecord,
  normalizeIsTest,
  parseAttributionCookie,
  reconcileUserAcquisition,
  sanitizeLandingPath,
  sanitizeMedium,
  sanitizeSlug,
  sanitizeSource,
  serializeAttributionCookie,
} from '../index.js';

describe('attribution allowlisting and normalization', () => {
  it('normalizes controlled source/medium values to lowercase', () => {
    expect(sanitizeSource('Instagram')).toBe('instagram');
    expect(sanitizeMedium('Organic_Social')).toBe('organic_social');
    expect(ALLOWED_SOURCES).toContain('instagram');
    expect(ALLOWED_MEDIUMS).toContain('organic_social');
  });

  it('accepts utm_* query fields and requires at least one recognized UTM', () => {
    const touch = attributionTouchFromQuery(
      {
        utm_source: 'Instagram',
        utm_medium: 'organic_social',
        utm_campaign: 'ca-west-coast',
        utm_content: 'reel-01',
      },
      '/index.html',
      new Date('2026-08-01T12:00:00.000Z')
    );
    expect(touch).toMatchObject({
      source: 'instagram',
      medium: 'organic_social',
      campaign: 'ca-west-coast',
      content: 'reel-01',
      landingPath: '/index.html',
      firstSeenAt: '2026-08-01T12:00:00.000Z',
      lastSeenAt: '2026-08-01T12:00:00.000Z',
    });
    expect(attributionTouchFromQuery({}, '/')).toBeNull();
    expect(attributionTouchFromQuery({ foo: 'bar' }, '/')).toBeNull();
  });

  it('rejects malformed, PII-like, and free-form values', () => {
    expect(sanitizeSource('not-a-source')).toBeNull();
    expect(sanitizeMedium('newsletter')).toBeNull();
    expect(sanitizeSlug('Joe Nelo')).toBeNull();
    expect(sanitizeSlug('alice@gmail.com')).toBeNull();
    expect(sanitizeSlug('caption with spaces')).toBeNull();
    expect(sanitizeSlug('a'.repeat(81))).toBeNull();
    expect(sanitizeLandingPath('https://evil.example/path')).toBeNull();
    expect(sanitizeLandingPath('javascript:alert(1)')).toBeNull();
    expect(sanitizeLandingPath('/ok/path')).toBe('/ok/path');
  });
});

describe('first-touch / last-touch merge', () => {
  it('keeps first touch fixed while last touch updates', () => {
    const first = attributionTouchFromQuery(
      { utm_source: 'instagram', utm_campaign: 'launch' },
      '/',
      new Date('2026-01-01T00:00:00.000Z')
    );
    const record = mergeAttributionRecord(null, first);
    const second = attributionTouchFromQuery(
      { utm_source: 'email', utm_medium: 'email', utm_campaign: 'nurture' },
      '/pricing',
      new Date('2026-02-01T00:00:00.000Z')
    );
    const merged = mergeAttributionRecord(record, second);
    expect(merged.firstTouch.source).toBe('instagram');
    expect(merged.firstTouch.campaign).toBe('launch');
    expect(merged.firstTouch.firstSeenAt).toBe('2026-01-01T00:00:00.000Z');
    expect(merged.lastTouch.source).toBe('email');
    expect(merged.lastTouch.campaign).toBe('nurture');
    expect(merged.lastTouch.lastSeenAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('does not overwrite attribution on untagged visits', () => {
    const first = attributionTouchFromQuery(
      { utm_source: 'facebook', utm_medium: 'paid_social' },
      '/',
      new Date('2026-03-01T00:00:00.000Z')
    );
    const record = mergeAttributionRecord(null, first);
    expect(mergeAttributionRecord(record, null)).toEqual(record);
    expect(reconcileUserAcquisition(record, null)).toEqual(record);
  });
});

describe('cookie serialize/parse', () => {
  const secret = 'test-attribution-secret';

  it('round-trips a signed cookie and ignores tampering', () => {
    const record = mergeAttributionRecord(
      null,
      attributionTouchFromQuery(
        { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'us-search' },
        '/',
        new Date('2026-04-01T00:00:00.000Z')
      )
    );
    const signed = serializeAttributionCookie(record, secret);
    expect(parseAttributionCookie(signed, secret)).toMatchObject({
      firstTouch: { source: 'google', campaign: 'us-search' },
    });
    expect(parseAttributionCookie(signed + 'x', secret)).toBeNull();
    expect(parseAttributionCookie('not-valid', secret)).toBeNull();
  });

  it('builds an HttpOnly SameSite=Lax Set-Cookie header', () => {
    const header = buildSetCookieHeader('abc.sig', { secure: true });
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Secure');
    expect(header).toContain('Max-Age=');
  });
});

describe('Stripe metadata + isTest', () => {
  it('serializes sanitized identifiers and is_test strings', () => {
    const acquisition = mergeAttributionRecord(
      null,
      attributionTouchFromQuery(
        { utm_source: 'linkedin', utm_medium: 'organic_social', utm_campaign: 'b2b' },
        '/',
        new Date('2026-05-01T00:00:00.000Z')
      )
    );
    const meta = attributionToStripeMetadata(acquisition, true);
    expect(meta).toEqual({
      attribution_source: 'linkedin',
      attribution_medium: 'organic_social',
      attribution_campaign: 'b2b',
      attribution_content: UNKNOWN,
      attribution_first_seen_at: '2026-05-01T00:00:00.000Z',
      attribution_last_seen_at: '2026-05-01T00:00:00.000Z',
      is_test: 'true',
    });
    expect(attributionToStripeMetadata(null, false).is_test).toBe('false');
    expect(attributionToStripeMetadata(null, false).attribution_source).toBe(UNKNOWN);
  });

  it('deserializes malformed Stripe metadata to unknown and isTest false', () => {
    expect(attributionFromStripeMetadata({})).toEqual({
      attribution: compactAttributionFromAcquisition(null),
      isTest: false,
    });
    const bad = attributionFromStripeMetadata({
      attribution_source: 'evil-tracker',
      attribution_medium: 'not-real',
      attribution_campaign: 'Joe Nelo',
      attribution_content: 'token=abc',
      attribution_first_seen_at: 'nope',
      attribution_last_seen_at: 'nope',
      is_test: 'yes',
    });
    expect(bad.attribution.source).toBe(UNKNOWN);
    expect(bad.attribution.medium).toBe(UNKNOWN);
    expect(bad.attribution.campaign).toBe(UNKNOWN);
    expect(bad.isTest).toBe(false);
  });

  it('treats missing isTest as false', () => {
    expect(normalizeIsTest(undefined)).toBe(false);
    expect(normalizeIsTest(null)).toBe(false);
    expect(normalizeIsTest(false)).toBe(false);
    expect(normalizeIsTest(true)).toBe(true);
    expect(normalizeIsTest('true')).toBe(true);
  });
});

describe('getAttributionCookieSecret', () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  it('falls back to SESSION_SECRET outside production', () => {
    delete process.env.ATTRIBUTION_COOKIE_SECRET;
    process.env.SESSION_SECRET = 'session-secret-value';
    process.env.NODE_ENV = 'test';
    expect(getAttributionCookieSecret()).toBe('session-secret-value');
  });

  it('throws in production when only the insecure fallback would apply', () => {
    delete process.env.ATTRIBUTION_COOKIE_SECRET;
    delete process.env.SESSION_SECRET;
    process.env.NODE_ENV = 'production';
    expect(() => getAttributionCookieSecret()).toThrow(/secure value/);
  });
});
