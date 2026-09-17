import { describe, expect, it, vi } from 'vitest';
import { getSsmfStripeHistoryAudit, pacificDayStartUtc, summarizeStripeHistoryAuditRows } from '../getSsmfStripeHistoryAudit.js';

const now = new Date('2026-09-14T12:00:00.000Z');
const query = { campaign_id: 'tic-2026-first-controlled-30-day', start: '2025-09-15', end: '2026-09-14' };
const filters = { campaignId: query.campaign_id, start: new Date('2025-09-15'), end: new Date('2026-09-14') };
const base = { amount: 2500, purchaseIsTest: false, userIsTest: false, userMatched: true };
const make = (userId, stripeSessionId, extra = {}) => ({ ...base, userId, stripeSessionId, ...extra });

describe('SSMF local Stripe history coverage audit', () => {
  it('counts test flags, refund markers, checkout references and postal availability without exposing rows', async () => {
    const rows = [
      make('person-a', 'cs_a', { billingAddress: { country: 'US', state: 'CA', city: 'San Diego', postal_code: '92101' } }),
      make('person-a', 'cs_b', { billingAddress: { country: 'US', postal_code: '92101-1234' }, lastRefundPartialAt: now }),
      make('person-b', 'cs_a', { billingAddress: { country: 'CA', state: 'BC', city: 'Victoria', postal_code: 'V8W 1A1' } }),
      make('person-c', null, { purchaseIsTest: undefined, userIsTest: undefined, billingAddress: { country: 'US', postal_code: 'bad-code' } }),
      make('test-paid', 'cs_test', { purchaseIsTest: true, userIsTest: true }),
      make('test-coupon', 'cs_coupon', { amount: 0, purchaseIsTest: true, userIsTest: true }),
      make('test-user', 'cs_user', { purchaseIsTest: true, userIsTest: true }),
      make('conflict', 'cs_conflict', { purchaseIsTest: true, userIsTest: false }),
      make('refund-full', 'cs_refund', { fullyRefundedAt: now }),
      make('unmatched', 'cs_unmatched', { userMatched: false }),
      make('never-paid', 'cs_cancel', { amount: 0, purchaseIsTest: false }),
    ];
    const audit = await summarizeStripeHistoryAuditRows(rows, filters, now);
    expect(audit.counts).toMatchObject({
      local_purchase_rows: 11,
      completed_paid_nonzero_local_rows: 9,
      zero_or_unknown_amount_rows: 2,
      explicit_purchase_test_rows: 4,
      explicit_purchase_non_test_rows: 6,
      missing_purchase_test_flag_rows: 1,
      explicit_flag_conflict_rows: 1,
      app_candidate_business_purchase_rows: 4,
      app_candidate_business_distinct_purchasers: 3,
      app_candidate_business_rows_with_missing_test_flag: 1,
    });
    expect(audit.checkout_reference_coverage).toEqual({
      candidate_rows_with_reference: 3,
      candidate_rows_without_reference: 1,
      distinct_candidate_references: 2,
      duplicate_candidate_reference_groups: 1,
      candidate_rows_in_duplicate_groups: 2,
    });
    expect(audit.local_refund_marker_coverage).toMatchObject({
      paid_rows_with_local_full_refund_marker: 1,
      paid_rows_with_local_partial_refund_marker: 1,
      stripe_refund_status_verified: false,
    });
    expect(audit.billing_field_coverage.postal_code).toEqual({
      purchase_rows_present: 4,
      distinct_purchasers_present: 3,
      purchase_rows_recognized_us_or_ca_format: 3,
      distinct_purchasers_recognized_us_or_ca_format: 2,
    });
    expect(audit.execution).toEqual({ dry_run: true, records_modified: false, live_stripe_read: false });
    expect(audit.privacy).toEqual({
      customer_rows_emitted: false, direct_identifiers_emitted: false,
      full_postal_codes_emitted: false, credentials_emitted: false,
    });
    const serialized = JSON.stringify(audit);
    for (const secret of ['person-a', 'cs_a', '92101', 'V8W 1A1', 'San Diego']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('runs only a bounded local read and closes the cursor', async () => {
    const close = vi.fn();
    const aggregate = vi.fn(() => ({
      async *[Symbol.asyncIterator]() { yield make('person-a', 'cs_a'); }, close,
    }));
    const db = { collection: vi.fn(() => ({ aggregate })) };
    const result = await getSsmfStripeHistoryAudit(db, query, now);
    expect(db.collection).toHaveBeenCalledWith('purchases');
    expect(aggregate).toHaveBeenCalledOnce();
    expect(aggregate.mock.calls[0][1]).toEqual({ maxTimeMS: 10_000 });
    expect(aggregate.mock.calls[0][0][0].$match.createdAt.$gte.toISOString()).toBe('2025-09-15T07:00:00.000Z');
    expect(aggregate.mock.calls[0][0][0].$match.createdAt.$lt.toISOString()).toBe('2026-09-15T07:00:00.000Z');
    expect(close).toHaveBeenCalledOnce();
    expect(result.counts.app_candidate_business_purchase_rows).toBe(1);
  });

  it('rejects a future or overlong window before touching the database', async () => {
    const db = { collection: vi.fn() };
    await expect(getSsmfStripeHistoryAudit(db, { ...query, end: '2026-09-15' }, now)).rejects.toThrow(/date range/);
    await expect(getSsmfStripeHistoryAudit(db, { ...query, start: '2025-09-14' }, now)).rejects.toThrow(/date range/);
    expect(db.collection).not.toHaveBeenCalled();
  });

  it('uses the Pacific calendar date when rejecting future audit windows', async () => {
    const db = { collection: vi.fn() };
    const beforePacificMidnight = new Date('2026-09-14T02:00:00.000Z');
    await expect(getSsmfStripeHistoryAudit(
      db,
      { ...query, start: '2026-09-13', end: '2026-09-14' },
      beforePacificMidnight,
    )).rejects.toThrow(/date range/);
    expect(db.collection).not.toHaveBeenCalled();
  });

  it('matches the approved Pacific historical year and both DST transition midnights', () => {
    expect(pacificDayStartUtc(new Date('2025-09-13T00:00:00Z')).toISOString()).toBe('2025-09-13T07:00:00.000Z');
    expect(pacificDayStartUtc(new Date('2026-09-13T00:00:00Z')).toISOString()).toBe('2026-09-13T07:00:00.000Z');
    expect(pacificDayStartUtc(new Date('2026-03-08T00:00:00Z')).toISOString()).toBe('2026-03-08T08:00:00.000Z');
    expect(pacificDayStartUtc(new Date('2026-03-09T00:00:00Z')).toISOString()).toBe('2026-03-09T07:00:00.000Z');
    expect(pacificDayStartUtc(new Date('2025-11-02T00:00:00Z')).toISOString()).toBe('2025-11-02T07:00:00.000Z');
    expect(pacificDayStartUtc(new Date('2025-11-03T00:00:00Z')).toISOString()).toBe('2025-11-03T08:00:00.000Z');
  });
});
