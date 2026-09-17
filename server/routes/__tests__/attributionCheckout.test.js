import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import {
  attributionToStripeMetadata,
  mergeAttributionRecord,
  attributionTouchFromQuery,
  UNKNOWN,
} from '../../attribution/index.js';
import {
  buildCheckoutAttributionMetadata,
  resolveProStationMetadata,
} from '../checkout.js';

describe('checkout attribution + station metadata helpers', () => {
  it('sends the same sanitized identifiers and is_test to Stripe metadata', () => {
    const acquisition = mergeAttributionRecord(
      null,
      attributionTouchFromQuery(
        {
          utm_source: 'instagram',
          utm_medium: 'organic_social',
          utm_campaign: 'ca-launch',
          utm_content: 'story-a',
        },
        '/',
        new Date('2026-06-01T10:00:00.000Z')
      )
    );
    const meta = buildCheckoutAttributionMetadata(acquisition, true);
    expect(meta).toEqual(
      attributionToStripeMetadata(acquisition, true)
    );
    expect(meta.is_test).toBe('true');
    expect(meta.attribution_source).toBe('instagram');
    expect(meta.attribution_campaign).toBe('ca-launch');
  });

  it('preserves one-time station fields when building alongside attribution', () => {
    const station = {
      stationID: '9414290',
      stationTitle: 'San Francisco',
      country: 'usa',
      stationLat: 37.8,
      stationLng: -122.4,
    };
    // One-time path keeps caller-provided station fields unchanged; helper is Pro-only.
    // Assert Pro helper does not invent stations for one-time-style inputs either.
    const pro = resolveProStationMetadata(station);
    expect(pro.stationID).toBe('9414290');
    expect(pro.stationTitle).toBe('San Francisco');
    expect(pro.country).toBe('usa');
    expect(pro.stationLat).toBe('37.8');
    expect(pro.stationLng).toBe('-122.4');
  });

  it('records a real Pro station when provided, otherwise unknown (never invented)', () => {
    expect(resolveProStationMetadata({})).toEqual({
      stationID: UNKNOWN,
      stationTitle: UNKNOWN,
      country: UNKNOWN,
    });
    expect(resolveProStationMetadata({ stationID: '9414290' })).toEqual({
      stationID: UNKNOWN,
      stationTitle: UNKNOWN,
      country: UNKNOWN,
    });
    expect(
      resolveProStationMetadata({
        stationID: '9414290',
        stationTitle: 'San Francisco',
        country: 'usa',
      })
    ).toEqual({
      stationID: '9414290',
      stationTitle: 'San Francisco',
      country: 'usa',
    });
  });
});

describe('createPurchaseFromSession attribution persistence', () => {
  let createPurchaseFromSession;
  let inserted;
  let existing;

  beforeEach(async () => {
    inserted = [];
    existing = [];
    vi.resetModules();

    vi.doMock('../../db/index.js', () => ({
      getDatabase: () => ({}),
    }));
    vi.doMock('../../auth/email.js', () => ({
      sendDownloadReady: vi.fn(),
    }));
    vi.doMock('stripe', () => ({
      default: class StripeMock {
        subscriptions = {
          retrieve: vi.fn(async () => ({
            id: 'sub_test',
            status: 'active',
            current_period_end: Math.floor(Date.now() / 1000) + 86400,
          })),
        };
      },
    }));

    ({ createPurchaseFromSession } = await import('../../services/checkoutCompleted.js'));
  });

  function mockDb() {
    return {
      collection(name) {
        if (name === 'purchases') {
          return {
            find: () => ({
              toArray: async () => existing,
            }),
            findOne: async (q) => {
              if (q?._id) return inserted.find((p) => p._id.equals(q._id)) || null;
              if (q?.stripeSessionId) {
                return existing.find((p) => p.stripeSessionId === q.stripeSessionId) || null;
              }
              return null;
            },
            insertOne: async (doc) => {
              const _id = new ObjectId();
              const row = { ...doc, _id };
              inserted.push(row);
              return { insertedId: _id };
            },
          };
        }
        if (name === 'users') {
          return {
            updateOne: async () => ({ modifiedCount: 1 }),
          };
        }
        throw new Error(`unexpected collection ${name}`);
      },
    };
  }

  const baseAttr = {
    attribution_source: 'instagram',
    attribution_medium: 'organic_social',
    attribution_campaign: 'ca-launch',
    attribution_content: 'story-a',
    attribution_first_seen_at: '2026-06-01T10:00:00.000Z',
    attribution_last_seen_at: '2026-06-02T10:00:00.000Z',
    is_test: 'false',
  };

  it('stores attribution and isTest on one-time tide purchases', async () => {
    const purchase = await createPurchaseFromSession(
      {
        id: 'cs_tide',
        mode: 'payment',
        amount_total: 999,
        currency: 'usd',
        payment_intent: 'pi_1',
        metadata: {
          plan: 'single',
          productType: 'tide',
          userId: new ObjectId().toString(),
          stationID: '9414290',
          stationTitle: 'San Francisco',
          country: 'usa',
          ...baseAttr,
        },
      },
      mockDb(),
      ObjectId
    );
    expect(purchase.product).toBe('single');
    expect(purchase.attribution.source).toBe('instagram');
    expect(purchase.attribution.campaign).toBe('ca-launch');
    expect(purchase.isTest).toBe(false);
    expect(purchase.regenerationParams.stationId).toBe('9414290');
  });

  it('stores attribution and isTest on golden, combined, and subscription paths', async () => {
    const userId = new ObjectId().toString();
    const db = mockDb();

    const golden = await createPurchaseFromSession(
      {
        id: 'cs_golden',
        mode: 'payment',
        amount_total: 499,
        currency: 'usd',
        metadata: {
          plan: 'single',
          productType: 'golden',
          userId,
          goldenLat: '49.28',
          goldenLng: '-123.12',
          goldenLocationName: 'Vancouver',
          ...baseAttr,
          is_test: 'true',
        },
      },
      db,
      ObjectId
    );
    expect(golden.product).toBe('golden');
    expect(golden.isTest).toBe(true);
    expect(golden.attribution.source).toBe('instagram');

    existing = [];
    inserted = [];
    const combined = await createPurchaseFromSession(
      {
        id: 'cs_combo',
        mode: 'payment',
        amount_total: 1499,
        currency: 'usd',
        metadata: {
          plan: 'single',
          productType: 'tide_and_golden',
          userId,
          stationID: '9414290',
          stationTitle: 'San Francisco',
          country: 'usa',
          goldenLat: '37.8',
          goldenLng: '-122.4',
          ...baseAttr,
        },
      },
      mockDb(),
      ObjectId
    );
    expect(combined.product).toBe('single');
    expect(combined.regenerationParams.includeGoldenHour).toBe(true);
    expect(combined.attribution.campaign).toBe('ca-launch');
    expect(combined.isTest).toBe(false);

    existing = [];
    inserted = [];
    const sub = await createPurchaseFromSession(
      {
        id: 'cs_sub',
        mode: 'subscription',
        amount_total: 2999,
        currency: 'usd',
        subscription: 'sub_test',
        metadata: {
          plan: 'subscription',
          userId,
          stationID: UNKNOWN,
          stationTitle: UNKNOWN,
          country: UNKNOWN,
          ...baseAttr,
        },
      },
      mockDb(),
      ObjectId
    );
    expect(sub.product).toBe('subscription');
    expect(sub.attribution.source).toBe('instagram');
    expect(sub.isTest).toBe(false);
    expect(sub.selectedStation).toEqual({
      stationId: UNKNOWN,
      stationTitle: UNKNOWN,
      country: UNKNOWN,
    });
  });

  it('persists a real Pro selected station on subscription purchases', async () => {
    const sub = await createPurchaseFromSession(
      {
        id: 'cs_sub_station',
        mode: 'subscription',
        amount_total: 2999,
        currency: 'usd',
        subscription: 'sub_test',
        metadata: {
          plan: 'subscription',
          userId: new ObjectId().toString(),
          stationID: '9414290',
          stationTitle: 'San Francisco',
          country: 'usa',
          stationLat: '37.8',
          stationLng: '-122.4',
          ...baseAttr,
        },
      },
      mockDb(),
      ObjectId
    );
    expect(sub.product).toBe('subscription');
    expect(sub.selectedStation).toEqual({
      stationId: '9414290',
      stationTitle: 'San Francisco',
      country: 'usa',
      latitude: 37.8,
      longitude: -122.4,
    });
  });

  it('uses safe unknown attribution when metadata is missing or malformed', async () => {
    const purchase = await createPurchaseFromSession(
      {
        id: 'cs_bad',
        mode: 'payment',
        amount_total: 999,
        currency: 'usd',
        metadata: {
          plan: 'single',
          productType: 'tide',
          userId: new ObjectId().toString(),
          stationID: '9414290',
          stationTitle: 'San Francisco',
          country: 'usa',
          attribution_source: 'hacked',
          is_test: 'YES',
        },
      },
      mockDb(),
      ObjectId
    );
    expect(purchase.attribution.source).toBe(UNKNOWN);
    expect(purchase.isTest).toBe(false);
  });

  it('remains idempotent on webhook retries', async () => {
    const session = {
      id: 'cs_idem',
      mode: 'payment',
      amount_total: 999,
      currency: 'usd',
      metadata: {
        plan: 'single',
        productType: 'tide',
        userId: new ObjectId().toString(),
        stationID: '9414290',
        stationTitle: 'San Francisco',
        country: 'usa',
        ...baseAttr,
      },
    };
    const db = mockDb();
    const first = await createPurchaseFromSession(session, db, ObjectId);
    existing = [first];
    inserted = [];
    const second = await createPurchaseFromSession(session, db, ObjectId);
    expect(second._id.toString()).toBe(first._id.toString());
    expect(inserted).toHaveLength(0);
  });
});
