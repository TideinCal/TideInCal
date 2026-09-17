import { describe, expect, it } from 'vitest';
import {
  buildCheckoutStartedPipeline,
  buildQualifyingPurchasePipeline,
  getSsmfBaseline,
  parseSsmfBaselineFilters,
} from '../getSsmfBaseline.js';

const now = new Date('2026-09-13T12:00:00.000Z');

function fixtureDb() {
  const userFilters = [];
  const purchasePipeline = [];
  const funnelPipeline = [];
  return {
    userFilters,
    purchasePipeline,
    funnelPipeline,
    db: {
      collection(name) {
        if (name === 'users') {
          return {
            countDocuments: async (filter) => {
              userFilters.push(filter);
              return [4, 3][userFilters.length - 1];
            },
          };
        }
        if (name === 'purchases') {
          return {
            aggregate: (pipeline) => {
              purchasePipeline.push(pipeline);
              return {
                toArray: async () => [{
                  paying_customers: [{ count: 2 }],
                  completed_local_purchases: [{ count: 5 }],
                  product_demand: [{ _id: 'subscription', count: 3 }, { _id: 'single', count: 3 }, { _id: 'moon', count: 2 }],
                  station_country_demand: [{ _id: 'usa', count: 3 }, { _id: 'canada', count: 2 }],
                  selected_station_demand: [{ _id: '9414290', count: 3 }, { _id: 'other', count: 2 }],
                  attribution_source: [{ _id: 'google', count: 4 }, { _id: 'direct', count: 1 }],
                }],
              };
            },
          };
        }
        if (name === 'funnel_events') {
          return {
            aggregate: (pipeline) => {
              funnelPipeline.push(pipeline);
              return { toArray: async () => [{ count: 6 }] };
            },
          };
        }
        throw new Error(`Unexpected collection ${name}`);
      },
    },
  };
}

describe('SSMF baseline filters', () => {
  it('requires hyphen-separated safe campaign IDs and a valid non-future range of at most 365 inclusive days', () => {
    const filters = parseSsmfBaselineFilters(
      { campaign_id: 'fall-2026', start: '2025-09-14', end: '2026-09-13' },
      now
    );
    expect(filters.inclusiveDays).toBe(365);
    expect(() => parseSsmfBaselineFilters({ campaign_id: 'Fall 2026', start: '2026-09-01', end: '2026-09-02' }, now))
      .toThrow('campaign_id');
    expect(() => parseSsmfBaselineFilters({ campaign_id: 'fall_2026', start: '2026-09-01', end: '2026-09-02' }, now))
      .toThrow('campaign_id');
    expect(() => parseSsmfBaselineFilters({ campaign_id: 'fall', start: '2026-09-14', end: '2026-09-14' }, now))
      .toThrow('not in the future');
    expect(() => parseSsmfBaselineFilters({ campaign_id: 'fall', start: '2025-09-13', end: '2026-09-13' }, now))
      .toThrow('365 inclusive days');
  });
});

describe('getSsmfBaseline', () => {
  it('returns bounded aggregate fixture totals, suppresses groups smaller than three, and excludes test/refunded rows in its pipeline', async () => {
    const fixture = fixtureDb();
    const result = await getSsmfBaseline(
      fixture.db,
      { campaign_id: 'fall-2026', start: '2026-09-01', end: '2026-09-13' },
      now
    );

    const total = (name) => result.totals.find((entry) => entry.name === name);
    const grouped = (name) => result.grouped_counts.find((entry) => entry.name === name);
    expect(total('registered_accounts')).toEqual({
      name: 'registered_accounts', available: true, value: 4, unavailable_reason: null,
    });
    expect(total('verified_email_accounts').value).toBe(3);
    expect(total('paying_customers').value).toBe(2);
    expect(total('completed_local_purchases').value).toBe(5);
    expect(total('checkout_started').value).toBe(6);
    expect(total('checkout_completed').value).toBe(5);
    expect(total('active_subscribers')).toEqual({
      name: 'active_subscribers', available: false, value: null, unavailable_reason: 'not_supported',
    });
    expect(grouped('product_demand').groups).toEqual({ single: 3, subscription: 3 });
    expect(Object.keys(grouped('product_demand').groups)).toEqual(['single', 'subscription']);
    expect(grouped('product_demand').suppressed_records).toBe(2);
    expect(grouped('attribution_source').groups).toEqual({ google: 4 });
    expect(grouped('attribution_source').suppressed_records).toBe(1);

    const purchaseMatch = fixture.purchasePipeline[0][0].$match;
    expect(purchaseMatch.isTest).toEqual({ $ne: true });
    expect(purchaseMatch.amount).toEqual({ $type: 'number', $gt: 0 });
    expect(purchaseMatch.$and).toContainEqual({
      $or: [{ fullyRefundedAt: { $exists: false } }, { fullyRefundedAt: null }],
    });
    expect(fixture.userFilters[0].createdAt.$gte).toEqual(new Date('2026-09-01T00:00:00.000Z'));
  });

  it('marks downloads and expired anonymous funnel history explicitly unavailable', async () => {
    const fixture = fixtureDb();
    const result = await getSsmfBaseline(
      fixture.db,
      { campaign_id: 'fall-2026', start: '2026-06-01', end: '2026-06-30' },
      now
    );

    expect(result.totals.find((entry) => entry.name === 'downloads')).toEqual({
      name: 'downloads', available: false, value: null, unavailable_reason: 'insufficient_history',
    });
    expect(result.totals.find((entry) => entry.name === 'checkout_started')).toEqual({
      name: 'checkout_started', available: false, value: null, unavailable_reason: 'insufficient_history',
    });
    expect(fixture.funnelPipeline).toHaveLength(0);
    expect(result.limitations).not.toHaveLength(0);
    expect(result.limitations.join(' ')).toContain('expire after 90 days');
  });

  it('has a fixed aggregate-only shape without prohibited identifier fields or client approval identity', async () => {
    const fixture = fixtureDb();
    const result = await getSsmfBaseline(
      fixture.db,
      { campaign_id: 'fall-2026', start: '2026-09-01', end: '2026-09-13' },
      now
    );

    expect(result.schema_version).toBe(1);
    expect(result.source).toBe('tide_app_aggregate');
    expect(result.window).toEqual({ start_date: '2026-09-01', end_date: '2026-09-13' });
    expect(result.export_context).toMatchObject({
      neutral_export: true,
      raw_export_approved: false,
      raw_export_accepted_by_tidy: false,
      generated_at: '2026-09-13T12:00:00.000Z',
      report_version: 'tide-app-aggregate-raw-v1',
      collector: 'CalendarWaves',
      campaign_id: 'fall-2026',
    });
    expect(result.privacy).toEqual({
      customer_rows_emitted: false, direct_identifiers_emitted: false, minimum_group_size: 3,
    });
    expect(result.totals.map((entry) => entry.name)).toEqual([
      'registered_accounts',
      'verified_email_accounts',
      'paying_customers',
      'active_subscribers',
      'completed_local_purchases',
      'downloads',
      'checkout_started',
      'checkout_completed',
    ]);
    expect(result.grouped_counts.map((entry) => entry.name)).toEqual([
      'product_demand',
      'station_country_demand',
      'selected_station_demand',
      'attribution_source',
    ]);
    for (const entry of result.totals) {
      expect(Object.keys(entry)).toEqual(['name', 'available', 'value', 'unavailable_reason']);
    }
    for (const entry of result.grouped_counts) {
      expect(Object.keys(entry)).toEqual([
        'name', 'available', 'groups', 'suppressed_records', 'minimum_group_size', 'unavailable_reason',
      ]);
    }
    expect(result.proposed_uses).toEqual([
      'summarize_baseline', 'compare_over_time', 'inform_content_mix', 'set_measurement_plan',
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /"(?:full_name|customer_name|first_name|last_name|email|phone|address|street|line1|line2|postal_code|customer|customer_id|user|user_id|account_id|stripe_id|mongo_id|_id|ip|ip_address|session_id)"\s*:/i
    );
  });

  it('uses user test status in qualifying purchase aggregates', () => {
    const pipeline = buildQualifyingPurchasePipeline({
      start: new Date('2026-09-01T00:00:00.000Z'),
      endInclusive: new Date('2026-09-01T23:59:59.999Z'),
    });
    expect(pipeline).toContainEqual({ $match: { 'user.isTest': { $ne: true } } });
  });

  it('counts checkout starts as distinct journeys', () => {
    const pipeline = buildCheckoutStartedPipeline({
      campaignId: 'fall-2026',
      start: new Date('2026-09-01T00:00:00.000Z'),
      endInclusive: new Date('2026-09-01T23:59:59.999Z'),
    });
    expect(pipeline.slice(-2)).toEqual([{ $group: { _id: '$journeyId' } }, { $count: 'count' }]);
  });
});
