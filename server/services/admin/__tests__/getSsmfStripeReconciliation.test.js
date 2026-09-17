import { describe, expect, it, vi } from 'vitest';
import {
  MAX_RECONCILIATION_CANDIDATES, MAX_RECONCILIATION_STRIPE_GET_CALLS, SSMF_RECONCILIATION_WINDOW,
  getSsmfStripeReconciliation, reconcileSsmfStripeCandidates,
} from '../getSsmfStripeReconciliation.js';

const now = new Date('2026-09-14T12:00:00.000Z');
const filters = { campaignId: 'tic-2026-first-controlled-30-day' };
const row = (id, extra = {}) => ({ stripeSessionId: id, purchaseIsTest: false, userIsTest: false, userMatched: true, ...extra });
const session = (id, extra = {}) => ({
  id, livemode: true, status: 'complete', payment_status: 'paid', amount_total: 2500,
  payment_intent: `pi_${id}`, mode: 'payment',
  metadata: { is_test: 'false' },
  customer_details: { address: { country: 'US', postal_code: '92101' } }, ...extra,
});

function stripeFor(sessions = {}, intents = {}, invoices = {}) {
  return {
    checkout: { sessions: { retrieve: vi.fn(async (id) => sessions[id]) } },
    paymentIntents: { retrieve: vi.fn(async (id) => {
      if (intents[id] instanceof Error) throw intents[id];
      return intents[id] || { latest_charge: { amount: 2500, amount_refunded: 0 } };
    }) },
    invoices: { retrieve: vi.fn(async (id) => {
      if (invoices[id] instanceof Error) throw invoices[id];
      return invoices[id];
    }) },
  };
}

describe('bounded aggregate SSMF Stripe reconciliation', () => {
  it('classifies zero-dollar, Stripe test, missing historical evidence, verified live, unmatched, mismatch, refund, unavailable, and cancellation without identifiers', async () => {
    const sessions = {
      zero: session('zero', { amount_total: 0 }),
      test: session('test', { livemode: false }),
      history: session('history'),
      verified: session('verified'),
      mismatch: session('other'),
      refunded: session('refunded'),
      unknownRefund: session('unknownRefund'),
      cancelled: session('cancelled', { status: 'expired', payment_status: 'unpaid' }),
      conflict: session('conflict'),
      geo2: session('geo2'),
      geo3: session('geo3'),
    };
    const stripe = stripeFor(sessions, {
      pi_refunded: { latest_charge: { amount: 2500, amount_refunded: 2500 } },
      pi_unknownRefund: new Error('not available'),
    });
    const report = await reconcileSsmfStripeCandidates([
      row('zero'), row('test'), row('history', { purchaseIsTest: undefined }),
      row('verified'), row('mismatch'), row('refunded'), row('unknownRefund'), row('cancelled'),
      row('conflict', { purchaseIsTest: true }), row('geo2'), row('geo3'),
    ], stripe, filters, now);
    expect(report.counts).toMatchObject({
      local_candidate_rows: 11, stripe_lookup_calls: 21, verified_non_test_non_refunded_matches: 3, unclassified_rows: 4,
    });
    expect(report.reason_buckets).toMatchObject({
      zero_dollar_paid_session: 1, stripe_test_session: 1, missing_local_test_evidence: 1,
      verified_non_test_non_refunded: 3, stripe_session_missing_or_mismatched: 1,
      full_refund: 1, unavailable: 1, checkout_cancelled_or_not_completed: 1, local_test_flag_conflict: 1,
    });
    expect(report.stripe_facts).toEqual({
      matching_sessions: 10, live_sessions: 9, test_sessions: 1, livemode_unavailable: 0,
      statuses: { complete: 9, open: 0, expired: 1, other: 0, unavailable: 1 },
      payment_statuses: { paid: 9, unpaid: 1, no_payment_required: 0, other: 0, unavailable: 1 },
      amounts: { positive: 9, zero_or_negative: 1, unavailable: 1 },
    });
    expect(report.refund_status).toEqual({ not_refunded: 8, partial_refund: 0, full_refund: 1, unavailable: 2 });
    expect(report.payment_kinds).toEqual({ one_time: 10, subscription: 0, unavailable: 0 });
    expect(report.verified_geography).toEqual({ groups: [{ region: 'US-921', count: 3 }], suppressed_groups_below_minimum: 0 });
    const serialized = JSON.stringify(report);
    for (const forbidden of ['pi_verified', '92101', 'cs_']) expect(serialized).not.toContain(forbidden);
  });

  it('retrieves Stripe evidence and refunds for all twenty missing-local-flag candidates before classifying them', async () => {
    const rows = Array.from({ length: MAX_RECONCILIATION_CANDIDATES }, (_, i) => row(`history-${i}`, { purchaseIsTest: undefined }));
    const sessions = Object.fromEntries(rows.map((candidate, i) => [
      candidate.stripeSessionId,
      session(candidate.stripeSessionId, { payment_intent: `pi_history-${i}` }),
    ]));
    const intents = Object.fromEntries(rows.map((candidate, i) => [
      `pi_history-${i}`,
      { latest_charge: { amount: 2500, amount_refunded: i === 0 ? 2500 : 0 } },
    ]));
    const stripe = stripeFor(sessions, intents);
    const report = await reconcileSsmfStripeCandidates(rows, stripe, filters, now);

    expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledTimes(20);
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledTimes(20);
    expect(report.counts).toMatchObject({ verified_non_test_non_refunded_matches: 0, unclassified_rows: 20 });
    expect(report.stripe_facts).toMatchObject({ matching_sessions: 20, live_sessions: 20, payment_statuses: { paid: 20 } });
    expect(report.refund_status).toEqual({ not_refunded: 19, partial_refund: 0, full_refund: 1, unavailable: 0 });
    expect(report.reason_buckets).toEqual({ missing_local_test_evidence: 20 });
  });

  it('uses explicit Stripe test metadata and conflicts as non-real evidence, while keeping cancellation distinct from refunds', async () => {
    const stripe = stripeFor({
      stripeTest: session('stripeTest', { metadata: { is_test: 'true' } }),
      conflicting: session('conflicting', { metadata: { is_test: 'true' } }),
      cancelled: session('cancelled', { status: 'expired', payment_status: 'unpaid' }),
      coupon: session('coupon', { amount_total: 0 }),
    });
    const report = await reconcileSsmfStripeCandidates([
      row('stripeTest', { purchaseIsTest: true, userIsTest: true }), row('conflicting'),
      row('cancelled'), row('coupon'),
    ], stripe, filters, now);

    expect(report.counts.verified_non_test_non_refunded_matches).toBe(0);
    expect(report.reason_buckets).toMatchObject({
      stripe_metadata_test: 1, test_evidence_conflict: 1, checkout_cancelled_or_not_completed: 1, zero_dollar_paid_session: 1,
    });
    expect(report.refund_status.not_refunded).toBe(4);
  });

  it('leaves missing and invalid local or Stripe test flags unclassified after collecting payment evidence', async () => {
    const stripe = stripeFor({
      missingStripe: session('missingStripe', { metadata: {} }),
      invalidStripe: session('invalidStripe', { metadata: { is_test: 'unknown' } }),
      invalidLocal: session('invalidLocal'),
    });
    const report = await reconcileSsmfStripeCandidates([
      row('missingStripe'), row('invalidStripe'), row('invalidLocal', { purchaseIsTest: 'false' }),
    ], stripe, filters, now);

    expect(report.counts).toMatchObject({ verified_non_test_non_refunded_matches: 0, unclassified_rows: 3 });
    expect(report.reason_buckets).toEqual({
      missing_stripe_test_evidence: 1, invalid_stripe_test_evidence: 1, invalid_local_test_evidence: 1,
    });
    expect(report.refund_status).toEqual({ not_refunded: 3, partial_refund: 0, full_refund: 0, unavailable: 0 });
  });

  it('follows payment and subscription invoice payment intents, and never exceeds sixty Stripe GET calls', async () => {
    const rows = Array.from({ length: MAX_RECONCILIATION_CANDIDATES }, (_, i) => row(`subscription-${i}`));
    const sessions = Object.fromEntries(rows.map((candidate, i) => [
      candidate.stripeSessionId,
      session(candidate.stripeSessionId, { mode: 'subscription', payment_intent: null, invoice: `in_${i}` }),
    ]));
    const invoices = Object.fromEntries(rows.map((_, i) => [
      `in_${i}`, { payment_intent: `pi_subscription-${i}` },
    ]));
    const intents = Object.fromEntries(rows.map((_, i) => [
      `pi_subscription-${i}`, { latest_charge: { amount: 2500, amount_refunded: i === 0 ? 100 : 0 } },
    ]));
    const stripe = stripeFor(sessions, intents, invoices);
    const report = await reconcileSsmfStripeCandidates(rows, stripe, filters, now);

    expect(report.counts.stripe_lookup_calls).toBe(MAX_RECONCILIATION_STRIPE_GET_CALLS);
    expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledTimes(20);
    expect(stripe.invoices.retrieve).toHaveBeenCalledTimes(20);
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledTimes(20);
    expect(report.payment_kinds).toEqual({ one_time: 0, subscription: 20, unavailable: 0 });
    expect(report.refund_status).toEqual({ not_refunded: 19, partial_refund: 1, full_refund: 0, unavailable: 0 });
  });

  it('fails closed before Stripe reads for missing, duplicate, or more than twenty references', async () => {
    const stripe = stripeFor();
    await expect(reconcileSsmfStripeCandidates([row('')], stripe, filters, now)).rejects.toThrow(/without a Checkout reference/);
    await expect(reconcileSsmfStripeCandidates([row('same'), row('same')], stripe, filters, now)).rejects.toThrow(/duplicate/);
    await expect(reconcileSsmfStripeCandidates(
      Array.from({ length: MAX_RECONCILIATION_CANDIDATES + 1 }, (_, i) => row(`bounded-${i}`)), stripe, filters, now
    )).rejects.toThrow(/candidate limit/);
    expect(stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
  });

  it('enforces the exact Pacific historical window before the database and uses only the bounded local candidate definition', async () => {
    const aggregate = vi.fn(() => ({ async *[Symbol.asyncIterator]() { yield row('one'); }, close: vi.fn() }));
    const db = { collection: vi.fn(() => ({ aggregate })) };
    const stripe = stripeFor({ one: session('one') });
    await expect(getSsmfStripeReconciliation(db, {
      campaign_id: filters.campaignId, start: SSMF_RECONCILIATION_WINDOW.start, end: SSMF_RECONCILIATION_WINDOW.end,
    }, now, stripe)).resolves.toMatchObject({ counts: { verified_non_test_non_refunded_matches: 1 } });
    expect(aggregate.mock.calls[0][1]).toEqual({ maxTimeMS: 10_000 });
    expect(aggregate.mock.calls[0][0]).toHaveLength(4);
    await expect(getSsmfStripeReconciliation(db, {
      campaign_id: filters.campaignId, start: '2025-09-14', end: SSMF_RECONCILIATION_WINDOW.end,
    }, now, stripe)).rejects.toThrow(/limited to/);
  });
});
