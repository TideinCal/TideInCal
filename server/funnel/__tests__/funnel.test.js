import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import {
  landingDedupeKey,
  productDedupeKey,
  productTypeFromCheckout,
  recordFunnelEvent,
  recordSignupCompleted,
} from '../index.js';
import {
  buildPurchaseReportPipeline,
  getCampaignFunnelReport,
  parseCampaignReportFilters,
} from '../report.js';
import { attributionTouchFromQuery, mergeAttributionRecord } from '../../attribution/index.js';
import { captureAttributionRequest } from '../../middleware/captureAttribution.js';
import { productSelectionSchema } from '../../routes/funnel.js';
import {
  recordPurchaseCompletedEvent,
  recordPurchaseCompletedEventSafely,
} from '../../services/checkoutCompleted.js';

const START = new Date('2026-08-01T00:00:00Z');
const END = new Date('2026-08-20T00:00:00Z');
const NOW = new Date('2026-08-21T00:00:00Z');
const VERIFY = new Set(['tidy_measurement_verification', 'cookie_only']);

function acquisition(campaign = 'launch', content = 'reel-1') {
  return mergeAttributionRecord(null, attributionTouchFromQuery({
    utm_source: 'instagram',
    utm_medium: 'organic_social',
    utm_campaign: campaign,
    utm_content: content,
  }, '/pricing', START));
}

function eventDb() {
  const rows = [];
  return {
    rows,
    collection(name) {
      expect(name).toBe('funnel_events');
      return {
        async insertOne(doc) {
          if (rows.some((row) => row.eventName === doc.eventName && row.dedupeKey === doc.dedupeKey)) {
            const error = new Error('duplicate');
            error.code = 11000;
            throw error;
          }
          rows.push(doc);
          return { insertedId: rows.length };
        },
      };
    },
  };
}

function reportDb({ events = [], purchases = [] }) {
  const pipelines = [];
  return {
    pipelines,
    collection(name) {
      return {
        aggregate(pipeline) {
          pipelines.push({ name, pipeline });
          const match = pipeline[0].$match;
          const targetCampaign = match.$and[0][name === 'purchases' ? 'attribution.campaign' : 'campaign'];
          const dateField = name === 'purchases' ? 'createdAt' : 'serverTimestamp';
          const range = match[dateField];

          if (name === 'funnel_events') {
            const eligible = events.filter((event) =>
              event.campaign === targetCampaign &&
              !VERIFY.has(event.campaign) && !VERIFY.has(event.content) &&
              event.isTest !== true &&
              event.serverTimestamp >= range.$gte && event.serverTimestamp < range.$lt
            );
            const distinct = (eventName) => new Set(
              eligible.filter((event) => event.eventName === eventName).map((event) => event.journeyId)
            ).size;
            const result = [{
              tagged: distinct('tagged_landing') ? [{ count: distinct('tagged_landing') }] : [],
              selected: distinct('product_selected') ? [{ count: distinct('product_selected') }] : [],
              signups: eligible.some((event) => event.eventName === 'signup_completed')
                ? [{ count: eligible.filter((event) => event.eventName === 'signup_completed').length }]
                : [],
              checkout: distinct('checkout_started') ? [{ count: distinct('checkout_started') }] : [],
            }];
            return { toArray: async () => result };
          }

          const windowPurchases = purchases.filter((purchase) =>
            purchase.attribution?.campaign === targetCampaign &&
            !VERIFY.has(purchase.attribution?.campaign) && !VERIFY.has(purchase.attribution?.content) &&
            purchase.isTest !== true && purchase.userId instanceof ObjectId &&
            typeof purchase.amount === 'number' && purchase.amount > 0 &&
            purchase.createdAt >= range.$gte && purchase.createdAt < range.$lt
          );
          const notFullyRefunded = (purchase) => purchase.fullyRefundedAt == null;
          const candidateUsers = [...new Map(
            windowPurchases.filter(notFullyRefunded).map((purchase) => [purchase.userId.toString(), purchase.userId])
          ).values()];
          const newUsers = candidateUsers.filter((userId) => !purchases.some((purchase) =>
            purchase.userId instanceof ObjectId && purchase.userId.equals(userId) &&
            purchase.createdAt < range.$gte && purchase.isTest !== true &&
            typeof purchase.amount === 'number' && purchase.amount > 0 && notFullyRefunded(purchase)
          ));
          const money = new Map();
          for (const purchase of windowPurchases) {
            const currency = purchase.currency || 'unknown';
            const row = money.get(currency) || { _id: currency, gross: 0, refunds: 0, net: 0 };
            row.gross += purchase.amount;
            row.refunds += purchase.fullyRefundedAt != null
              ? purchase.amount
              : (purchase.refundedAmount || 0);
            row.net = row.gross - row.refunds;
            money.set(currency, row);
          }
          const result = [{
            paying: newUsers.length ? [{ customers: newUsers.length }] : [],
            completed: windowPurchases.length ? [{
              purchases: windowPurchases.length,
              subscriptions: windowPurchases.filter((purchase) => purchase.product === 'subscription').length,
            }] : [],
            money: [...money.values()],
          }];
          return { toArray: async () => result };
        },
      };
    },
  };
}

function funnelEvent(eventName, journeyId, overrides = {}) {
  return {
    eventName,
    journeyId,
    campaign: 'launch',
    content: 'reel-1',
    serverTimestamp: new Date('2026-08-10T00:00:00Z'),
    ...overrides,
  };
}

function purchase(userId, amount, overrides = {}) {
  return {
    userId,
    amount,
    currency: 'usd',
    product: 'single',
    isTest: false,
    createdAt: new Date('2026-08-10T00:00:00Z'),
    attribution: { campaign: 'launch', content: 'reel-1' },
    ...overrides,
  };
}

describe('authoritative event semantics', () => {
  it('records one valid tagged landing and no untagged landing', async () => {
    const db = eventDb();
    const cookies = [];
    const res = { append: (_name, value) => cookies.push(value) };
    const taggedReq = {
      path: '/pricing',
      query: { utm_source: 'instagram', utm_campaign: 'launch', utm_content: 'reel-1' },
      headers: {},
    };
    const result = await captureAttributionRequest({ req: taggedReq, res, db, secret: 'test-secret', now: START });
    expect(result.tagged).toBe(true);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].eventName).toBe('tagged_landing');
    expect(cookies).toHaveLength(1);

    const repeatedReq = {
      ...taggedReq,
      headers: { cookie: cookies[0].split(';')[0] },
    };
    await captureAttributionRequest({ req: repeatedReq, res, db, secret: 'test-secret', now: START });
    expect(db.rows).toHaveLength(1);

    const untaggedReq = { path: '/', query: {}, headers: {} };
    expect((await captureAttributionRequest({ req: untaggedReq, res, db, secret: 'test-secret', now: START })).tagged).toBe(false);
    expect(db.rows).toHaveLength(1);
  });

  it('records a new signup but not an existing-user idempotent signup', async () => {
    const db = eventDb();
    const a = acquisition();
    expect((await recordSignupCompleted({ db, acquisition: a, createdUserId: new ObjectId() })).recorded).toBe(true);
    expect((await recordSignupCompleted({ db, acquisition: a, createdUserId: null })).recorded).toBe(false);
    expect(db.rows.map((row) => row.eventName)).toEqual(['signup_completed']);
  });

  it('records completed checkout purchases idempotently and not before completion', async () => {
    const db = eventDb();
    const user = { acquisition: acquisition(), isTest: false };
    expect((await recordPurchaseCompletedEvent({ db, session: null, purchase: null, user })).recorded).toBe(false);
    const args = {
      db,
      session: { id: 'cs_completed', metadata: { plan: 'single', country: 'usa' } },
      purchase: { userId: new ObjectId() },
      user,
    };
    expect((await recordPurchaseCompletedEvent(args)).recorded).toBe(true);
    expect((await recordPurchaseCompletedEvent(args)).recorded).toBe(false);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].eventName).toBe('purchase_completed');
    expect(db.rows[0].dedupeKey).not.toContain('cs_completed');
  });

  it('does not fail the completed-purchase path when funnel persistence fails', async () => {
    const userId = new ObjectId();
    const db = {
      collection(name) {
        expect(name).toBe('funnel_events');
        return {
          insertOne: async () => {
            throw new Error('analytics unavailable');
          },
        };
      },
    };
    const result = await recordPurchaseCompletedEventSafely({
      db,
      session: { id: 'cs_analytics_failure', metadata: { plan: 'single', country: 'usa' } },
      purchase: { userId },
      user: { acquisition: acquisition(), isTest: false },
    });
    expect(result).toEqual({ recorded: false, reason: 'analytics_write_failed' });
  });
});

describe('minimum event document', () => {
  it('omits anonymous identity and redundant derived/session fields', async () => {
    const db = eventDb();
    const a = acquisition();
    const now = new Date('2026-08-02T00:00:00Z');
    await recordFunnelEvent({ db, eventName: 'tagged_landing', acquisition: a, dedupeKey: landingDedupeKey(a), now });
    expect(db.rows[0]).not.toHaveProperty('userId');
    expect(db.rows[0]).not.toHaveProperty('stripeSessionId');
    expect(db.rows[0]).not.toHaveProperty('verificationTraffic');
    expect(db.rows[0]).not.toHaveProperty('productType');
    expect(Object.keys(db.rows[0]).sort()).toEqual([
      'campaign', 'content', 'dedupeKey', 'eventName', 'expiresAt', 'journeyId',
      'landingPath', 'medium', 'serverTimestamp', 'source',
    ].sort());
    expect(db.rows[0].expiresAt.getTime() - now.getTime()).toBe(90 * 86400000);
  });

  it('stores authenticated identity/test state without an anonymous TTL', async () => {
    const db = eventDb();
    const userId = new ObjectId();
    await recordFunnelEvent({
      db, eventName: 'checkout_started', acquisition: acquisition(), productType: 'single',
      stationCountry: 'usa', userId, isTest: true, dedupeKey: 'cs_one',
    });
    expect(db.rows[0]).toMatchObject({ userId, isTest: true, productType: 'single', stationCountry: 'usa' });
    expect(db.rows[0]).not.toHaveProperty('expiresAt');
  });

  it('deduplicates selection retries and rejects unknown/disallowed data', async () => {
    const db = eventDb();
    const a = acquisition();
    const args = { db, eventName: 'product_selected', acquisition: a, productType: 'single', dedupeKey: productDedupeKey(a, 'single') };
    expect((await recordFunnelEvent(args)).recorded).toBe(true);
    expect((await recordFunnelEvent(args)).recorded).toBe(false);
    await expect(recordFunnelEvent({ db, eventName: 'page_view', acquisition: a, dedupeKey: 'x' })).rejects.toThrow(/Unknown/);
    expect(() => productSelectionSchema.parse({ productType: 'single', email: 'x@example.com' })).toThrow();
  });

  it('derives stable products for all checkout variants', () => {
    expect(productTypeFromCheckout({ plan: 'single' })).toBe('single');
    expect(productTypeFromCheckout({ plan: 'single', goldenOnly: true })).toBe('golden');
    expect(productTypeFromCheckout({ plan: 'single', includeGoldenHour: true })).toBe('tide_and_golden');
    expect(productTypeFromCheckout({ plan: 'unlimited' })).toBe('subscription');
  });
});

describe('campaign report fixture semantics', () => {
  it('excludes test/verification traffic and computes mixed totals', async () => {
    const events = [];
    for (const journey of ['j1', 'j2', 'j3']) {
      events.push(funnelEvent('tagged_landing', journey), funnelEvent('product_selected', journey));
      events.push(funnelEvent('signup_completed', journey), funnelEvent('checkout_started', journey));
    }
    events.push(funnelEvent('tagged_landing', 'j4'), funnelEvent('product_selected', 'j4'));
    events.push(funnelEvent('tagged_landing', 'test', { isTest: true }));
    events.push(funnelEvent('tagged_landing', 'verify', { campaign: 'tidy_measurement_verification' }));
    events.push(funnelEvent('tagged_landing', 'cookie', { content: 'cookie_only' }));

    const uNew = new ObjectId();
    const uReturning = new ObjectId();
    const uPriorRefund = new ObjectId();
    const uFull = new ObjectId();
    const uPartial = new ObjectId();
    const purchases = [
      purchase(uNew, 1000), purchase(uNew, 500),
      purchase(uReturning, 2000, { product: 'subscription' }),
      purchase(uReturning, 300, { createdAt: new Date('2026-07-01T00:00:00Z') }),
      purchase(uPriorRefund, 2500, { product: 'subscription', currency: 'cad' }),
      purchase(uPriorRefund, 400, { createdAt: new Date('2026-07-01T00:00:00Z'), fullyRefundedAt: new Date('2026-07-02T00:00:00Z') }),
      purchase(uFull, 700, { fullyRefundedAt: new Date('2026-08-11T00:00:00Z') }),
      purchase(uPartial, 1000, { refundedAmount: 200 }),
      purchase(new ObjectId(), 900, { isTest: true }),
      purchase(new ObjectId(), 800, { attribution: { campaign: 'launch', content: 'cookie_only' } }),
    ];
    const report = await getCampaignFunnelReport(reportDb({ events, purchases }), { campaign: 'launch', start: START, end: END }, NOW);
    expect(report).toMatchObject({
      taggedJourneys: 4, selectedJourneys: 4, completedSignups: 3, checkoutJourneys: 3,
      payingCustomers: 3, completedPurchases: 6, proSubscriptionsStarted: 2,
      grossByCurrency: { usd: 5200, cad: 2500 },
      refundsByCurrency: { usd: 900, cad: 0 },
      netByCurrency: { usd: 4300, cad: 2500 },
      conversionPercentages: {
        landingToSelection: 100, selectionToSignup: 75,
        signupToCheckout: 100, checkoutToPayingCustomer: 100,
      },
    });
    expect(JSON.stringify(report)).not.toMatch(/"(?:email|name|stationTitle|userId)"/i);
  });

  it('does not count a full-refund window purchase or returning paid customer as new', async () => {
    const returning = new ObjectId();
    const fullOnly = new ObjectId();
    const report = await getCampaignFunnelReport(reportDb({ purchases: [
      purchase(returning, 500, { createdAt: new Date('2026-07-01T00:00:00Z') }),
      purchase(returning, 1000),
      purchase(fullOnly, 700, { fullyRefundedAt: new Date('2026-08-12T00:00:00Z') }),
    ] }), { campaign: 'launch', start: START, end: END }, NOW);
    expect(report.payingCustomers).toBe(0);
    expect(report.completedPurchases).toBe(2);
    expect(report.refundsByCurrency).toEqual({ usd: 700 });
  });

  it('allows a customer whose only prior purchase was fully refunded', async () => {
    const userId = new ObjectId();
    const report = await getCampaignFunnelReport(reportDb({ purchases: [
      purchase(userId, 500, { createdAt: new Date('2026-07-01T00:00:00Z'), fullyRefundedAt: new Date('2026-07-02T00:00:00Z') }),
      purchase(userId, 1000),
    ] }), { campaign: 'launch', start: START, end: END }, NOW);
    expect(report.payingCustomers).toBe(1);
  });

  it('uses zero-safe conversion denominators', async () => {
    const report = await getCampaignFunnelReport(reportDb({}), { campaign: 'launch', start: START, end: END }, NOW);
    expect(report.conversionPercentages).toEqual({
      landingToSelection: 0, selectionToSignup: 0,
      signupToCheckout: 0, checkoutToPayingCustomer: 0,
    });
  });

  it('builds the prior-paid lookup from the full purchases collection', () => {
    const filters = parseCampaignReportFilters({ campaign: 'launch', start: START, end: END }, NOW);
    const paying = buildPurchaseReportPipeline(filters)[1].$facet.paying;
    const lookup = paying.find((stage) => stage.$lookup).$lookup;
    expect(lookup.from).toBe('purchases');
    expect(lookup.let).toEqual({ candidateUserId: '$_id' });
    expect(lookup.pipeline.at(-1)).toEqual({ $limit: 1 });
    const priorConditions = lookup.pipeline[0].$match.$expr.$and;
    expect(priorConditions).toContainEqual({ $lt: ['$createdAt', START] });
    expect(priorConditions).toContainEqual({ $gt: ['$amount', 0] });
    expect(priorConditions).toContainEqual({ $ne: [{ $ifNull: ['$isTest', false] }, true] });
    expect(priorConditions).toContainEqual({ $eq: [{ $ifNull: ['$fullyRefundedAt', null] }, null] });
    expect(paying.at(-1)).toEqual({ $count: 'customers' });
  });

  it('validates an allowlisted, bounded date range', () => {
    expect(parseCampaignReportFilters({ campaign: 'launch', start: START, end: END }, NOW)).toMatchObject({ campaign: 'launch' });
    expect(() => parseCampaignReportFilters({ campaign: 'launch', start: '2026-01-01', end: END }, NOW)).toThrow(/31 days/);
    expect(() => parseCampaignReportFilters({ campaign: 'Joe Smith', start: START, end: END }, NOW)).toThrow();
  });
});
