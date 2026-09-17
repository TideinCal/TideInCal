import Stripe from 'stripe';
import { parseSsmfBaselineFilters } from './getSsmfBaseline.js';
import { pacificDayStartUtc } from './getSsmfStripeHistoryAudit.js';

export const SSMF_STRIPE_RECONCILIATION_SOURCE = 'tide_app_ssmf_stripe_reconciliation';
export const SSMF_STRIPE_RECONCILIATION_SCHEMA_VERSION = 1;
export const SSMF_RECONCILIATION_WINDOW = Object.freeze({ start: '2025-09-13', end: '2026-09-12' });
export const MAX_RECONCILIATION_CANDIDATES = 20;
export const MAX_RECONCILIATION_STRIPE_GET_CALLS = 60;
const MINIMUM_GEOGRAPHY_GROUP_SIZE = 3;

function explicitFlag(value) {
  if (value === true) return 'test';
  if (value === false) return 'non_test';
  if (value === undefined || value === null) return 'missing';
  return 'invalid';
}

function add(bucket, key) {
  bucket[key] = (bucket[key] || 0) + 1;
}

function broadRegion(address) {
  const country = typeof address?.country === 'string' ? address.country.trim().toUpperCase() : '';
  const postal = typeof address?.postal_code === 'string' ? address.postal_code.trim().toUpperCase() : '';
  if (country === 'US' && /^\d{5}(?:-?\d{4})?$/.test(postal)) return `US-${postal.slice(0, 3)}`;
  if (country === 'CA' && /^[A-Z]\d[A-Z][ -]?\d[A-Z]\d$/.test(postal)) return `CA-${postal.slice(0, 3)}`;
  return null;
}

function localEvidence(row) {
  const purchase = explicitFlag(row.purchaseIsTest);
  const user = row.userMatched === true ? explicitFlag(row.userIsTest) : 'missing';
  if (purchase === 'invalid' || user === 'invalid') return 'invalid_local_test_evidence';
  if (purchase !== 'missing' && user !== 'missing' && purchase !== user) return 'local_test_flag_conflict';
  if (purchase === 'test' || user === 'test') return 'local_test';
  if (purchase !== 'non_test' || user !== 'non_test') return 'missing_local_test_evidence';
  return 'explicit_local_non_test';
}

function stripeMetadataEvidence(session) {
  // Stripe metadata values are strings in API responses; booleans are accepted
  // here only for compatible test doubles.
  const value = session?.metadata?.is_test;
  if (value === true || value === 'true') return 'stripe_metadata_test';
  if (value === false || value === 'false') return 'explicit_stripe_non_test';
  if (value === undefined || value === null) return 'missing_stripe_test_evidence';
  return 'invalid_stripe_test_evidence';
}

function refundStateFromIntent(intent) {
  const charge = intent?.latest_charge;
  if (!charge || typeof charge !== 'object' || typeof charge.amount !== 'number' || typeof charge.amount_refunded !== 'number') {
    return 'unavailable';
  }
  if (charge.amount_refunded >= charge.amount) return 'full_refund';
  if (charge.amount_refunded > 0) return 'partial_refund';
  return 'not_refunded';
}

/**
 * Reconciles a pre-bounded in-memory candidate set. The returned value never
 * includes a Checkout reference, Stripe object, purchaser, or raw address.
 */
export async function reconcileSsmfStripeCandidates(rows, stripe, filters, generatedAt = new Date()) {
  const candidates = [];
  const seen = new Set();
  for await (const row of rows) {
    if (candidates.length >= MAX_RECONCILIATION_CANDIDATES) {
      throw new TypeError('historical reconciliation candidate limit exceeded; no partial report was returned');
    }
    const reference = typeof row.stripeSessionId === 'string' ? row.stripeSessionId.trim() : '';
    if (!reference) throw new TypeError('historical reconciliation has a candidate without a Checkout reference; no partial report was returned');
    if (seen.has(reference)) throw new TypeError('historical reconciliation has duplicate Checkout references; no partial report was returned');
    seen.add(reference);
    candidates.push({ ...row, stripeSessionId: reference });
  }

  const counts = {
    local_candidate_rows: candidates.length,
    stripe_lookup_calls: 0,
    verified_non_test_non_refunded_matches: 0,
    unclassified_rows: 0,
  };
  const reasons = {};
  const stripe_facts = {
    matching_sessions: 0, live_sessions: 0, test_sessions: 0, livemode_unavailable: 0,
    statuses: { complete: 0, open: 0, expired: 0, other: 0, unavailable: 0 },
    payment_statuses: { paid: 0, unpaid: 0, no_payment_required: 0, other: 0, unavailable: 0 },
    amounts: { positive: 0, zero_or_negative: 0, unavailable: 0 },
  };
  const refunds = { not_refunded: 0, partial_refund: 0, full_refund: 0, unavailable: 0 };
  const payment_kinds = { one_time: 0, subscription: 0, unavailable: 0 };
  const geography = new Map();
  let aggregateUnavailable = false;

  const retrieve = async (method, id, options) => {
    if (counts.stripe_lookup_calls >= MAX_RECONCILIATION_STRIPE_GET_CALLS) {
      throw new TypeError('historical reconciliation Stripe GET call limit exceeded; no partial report was returned');
    }
    counts.stripe_lookup_calls += 1;
    return method(id, options);
  };

  const recordRefund = async (session) => {
    const paymentKind = session.mode === 'payment' ? 'one_time' : session.mode === 'subscription' ? 'subscription' : 'unavailable';
    payment_kinds[paymentKind] += 1;
    if (paymentKind === 'unavailable') return 'unavailable';
    try {
      if (paymentKind === 'one_time') {
        if (typeof session.payment_intent !== 'string' || !session.payment_intent) return 'unavailable';
        const intent = await retrieve(stripe.paymentIntents.retrieve.bind(stripe.paymentIntents), session.payment_intent, { expand: ['latest_charge'] });
        return refundStateFromIntent(intent);
      }
      const invoiceId = typeof session.invoice === 'string' ? session.invoice : session.invoice?.id;
      if (!invoiceId) return 'unavailable';
      const invoice = await retrieve(stripe.invoices.retrieve.bind(stripe.invoices), invoiceId, { expand: ['payment_intent.latest_charge'] });
      if (invoice?.payment_intent && typeof invoice.payment_intent === 'object') return refundStateFromIntent(invoice.payment_intent);
      const paymentIntentId = typeof invoice?.payment_intent === 'string' ? invoice.payment_intent : '';
      if (!paymentIntentId) return 'unavailable';
      const intent = await retrieve(stripe.paymentIntents.retrieve.bind(stripe.paymentIntents), paymentIntentId, { expand: ['latest_charge'] });
      return refundStateFromIntent(intent);
    } catch (error) {
      if (error instanceof TypeError && /Stripe GET call limit exceeded/.test(error.message)) throw error;
      aggregateUnavailable = true;
      return 'unavailable';
    }
  };

  for (const row of candidates) {
    let session;
    try {
      session = await retrieve(stripe.checkout.sessions.retrieve.bind(stripe.checkout.sessions), row.stripeSessionId);
    } catch (error) {
      if (error instanceof TypeError && /Stripe GET call limit exceeded/.test(error.message)) throw error;
      aggregateUnavailable = true;
      counts.unclassified_rows += 1;
      add(reasons, 'stripe_session_unavailable');
      stripe_facts.statuses.unavailable += 1;
      stripe_facts.payment_statuses.unavailable += 1;
      stripe_facts.amounts.unavailable += 1;
      refunds.unavailable += 1;
      continue;
    }
    if (!session || session.id !== row.stripeSessionId) {
      counts.unclassified_rows += 1;
      add(reasons, 'stripe_session_missing_or_mismatched');
      stripe_facts.statuses.unavailable += 1;
      stripe_facts.payment_statuses.unavailable += 1;
      stripe_facts.amounts.unavailable += 1;
      refunds.unavailable += 1;
      continue;
    }
    stripe_facts.matching_sessions += 1;
    if (session.livemode !== true && session.livemode !== false) {
      stripe_facts.livemode_unavailable += 1;
    } else if (session.livemode) {
      stripe_facts.live_sessions += 1;
    } else {
      stripe_facts.test_sessions += 1;
    }
    stripe_facts.statuses[['complete', 'open', 'expired'].includes(session.status) ? session.status : 'other'] += 1;
    stripe_facts.payment_statuses[['paid', 'unpaid', 'no_payment_required'].includes(session.payment_status) ? session.payment_status : 'other'] += 1;
    stripe_facts.amounts[typeof session.amount_total !== 'number' ? 'unavailable' : session.amount_total > 0 ? 'positive' : 'zero_or_negative'] += 1;
    const refund = await recordRefund(session);
    refunds[refund] += 1;

    const local = localEvidence(row);
    const stripeFlag = stripeMetadataEvidence(session);
    const classificationReason =
      session.livemode === false ? 'stripe_test_session' :
      session.livemode !== true ? 'stripe_livemode_unavailable' :
      (local === 'explicit_local_non_test' && stripeFlag === 'stripe_metadata_test') ||
      (local === 'local_test' && stripeFlag === 'explicit_stripe_non_test') ? 'test_evidence_conflict' :
      stripeFlag === 'stripe_metadata_test' ? 'stripe_metadata_test' :
      local !== 'explicit_local_non_test' ? local :
      stripeFlag !== 'explicit_stripe_non_test' ? stripeFlag :
      session.status === 'expired' || session.status === 'open' ? 'checkout_cancelled_or_not_completed' :
      session.status !== 'complete' || session.payment_status !== 'paid' ? 'checkout_not_verified_paid' :
      typeof session.amount_total !== 'number' || session.amount_total <= 0 ? 'zero_dollar_paid_session' :
      session.mode !== 'payment' && session.mode !== 'subscription' ? 'payment_kind_unavailable' :
      refund !== 'not_refunded' ? refund : null;
    if (classificationReason) {
      if (classificationReason === 'stripe_livemode_unavailable' || classificationReason === 'missing_local_test_evidence' ||
          classificationReason === 'invalid_local_test_evidence' || classificationReason === 'local_test_flag_conflict' ||
          classificationReason === 'test_evidence_conflict' || classificationReason === 'missing_stripe_test_evidence' ||
          classificationReason === 'invalid_stripe_test_evidence' ||
          classificationReason === 'unavailable' || classificationReason === 'checkout_not_verified_paid' ||
          classificationReason === 'payment_kind_unavailable') counts.unclassified_rows += 1;
      add(reasons, classificationReason);
      continue;
    }
    counts.verified_non_test_non_refunded_matches += 1;
    add(reasons, 'verified_non_test_non_refunded');
    const region = broadRegion(session.customer_details?.address);
    if (region) geography.set(region, (geography.get(region) || 0) + 1);
  }

  const regions = [...geography.entries()]
    .filter(([, count]) => count >= MINIMUM_GEOGRAPHY_GROUP_SIZE)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([region, count]) => ({ region, count }));
  return {
    schema_version: SSMF_STRIPE_RECONCILIATION_SCHEMA_VERSION,
    source: SSMF_STRIPE_RECONCILIATION_SOURCE,
    window: { start_date: SSMF_RECONCILIATION_WINDOW.start, end_date: SSMF_RECONCILIATION_WINDOW.end, time_zone: 'America/Vancouver' },
    generated_at: generatedAt.toISOString(),
    export_context: { campaign_id: filters.campaignId, neutral_export: true, report_label_only: true },
    execution: {
      records_modified: false, live_stripe_read: true, stripe_lookup_call_cap: MAX_RECONCILIATION_STRIPE_GET_CALLS,
      stripe_aggregate_available: !aggregateUnavailable,
    },
    privacy: {
      customer_rows_emitted: false, direct_identifiers_emitted: false, checkout_references_emitted: false,
      full_postal_codes_emitted: false, raw_stripe_responses_emitted: false, credentials_emitted: false,
      minimum_geography_group_size: MINIMUM_GEOGRAPHY_GROUP_SIZE,
    },
    counts,
    stripe_facts,
    reason_buckets: reasons,
    refund_status: refunds,
    payment_kinds,
    verified_geography: { groups: regions, suppressed_groups_below_minimum: [...geography.values()].filter((count) => count < MINIMUM_GEOGRAPHY_GROUP_SIZE).length },
    limitations: [
      'Only matching live, paid, positive Stripe Checkout Sessions with explicit non-test local and Stripe metadata evidence can be verified.',
      'Livemode and paid status alone never establish a confirmed real sale; missing, invalid, or conflicting test evidence is unclassified.',
      'Refund status that cannot be retrieved is unavailable and is not counted as unrefunded.',
    ],
  };
}

export async function getSsmfStripeReconciliation(db, rawFilters, now = new Date(), stripe = new Stripe(process.env.STRIPE_SECRET_KEY)) {
  const filters = parseSsmfBaselineFilters(rawFilters, now);
  if (filters.start.toISOString().slice(0, 10) !== SSMF_RECONCILIATION_WINDOW.start ||
      filters.end.toISOString().slice(0, 10) !== SSMF_RECONCILIATION_WINDOW.end) {
    throw new TypeError('historical reconciliation is limited to 2025-09-13 through 2026-09-12 Pacific dates');
  }
  const startUtc = pacificDayStartUtc(filters.start);
  const endExclusiveUtc = pacificDayStartUtc(new Date(filters.end.getTime() + 24 * 60 * 60 * 1000));
  const cursor = db.collection('purchases').aggregate([
    { $match: {
      createdAt: { $gte: startUtc, $lt: endExclusiveUtc }, amount: { $gt: 0 }, fullyRefundedAt: null,
      userId: { $ne: null }, isTest: { $ne: true },
    } },
    { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', pipeline: [{ $project: { _id: 0, isTest: 1 } }], as: 'matchedUser' } },
    { $match: { 'matchedUser.0': { $exists: true }, 'matchedUser.isTest': { $ne: true } } },
    { $project: { _id: 0, stripeSessionId: 1, purchaseIsTest: '$isTest', userMatched: { $gt: [{ $size: '$matchedUser' }, 0] }, userIsTest: { $arrayElemAt: ['$matchedUser.isTest', 0] } } },
  ], { maxTimeMS: 10_000 });
  try {
    return await reconcileSsmfStripeCandidates(cursor, stripe, filters, now);
  } finally {
    if (typeof cursor.close === 'function') await cursor.close();
  }
}
