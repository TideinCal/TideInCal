import { parseSsmfBaselineFilters } from './getSsmfBaseline.js';

export const STRIPE_HISTORY_AUDIT_SCHEMA_VERSION = 1;
export const STRIPE_HISTORY_AUDIT_SOURCE = 'tide_app_stripe_history_audit';
const MAX_AUDIT_ROWS = 100_000;
const BILLING_FIELDS = ['country', 'state', 'city', 'postal_code'];
const PACIFIC_TIME_ZONE = 'America/Vancouver';
const pacificParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: PACIFIC_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function pacificOffsetMilliseconds(instant) {
  const fields = Object.fromEntries(
    pacificParts.formatToParts(instant).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)])
  );
  const localAsUtc = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second);
  return localAsUtc - instant.getTime();
}

function pacificDateString(instant) {
  const fields = Object.fromEntries(
    pacificParts.formatToParts(instant).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)])
  );
  return `${fields.year}-${String(fields.month).padStart(2, '0')}-${String(fields.day).padStart(2, '0')}`;
}

/** Resolve a Pacific calendar midnight to an absolute UTC instant, including DST edges. */
export function pacificDayStartUtc(dateOnlyUtc) {
  const wallClockAsUtc = dateOnlyUtc.getTime();
  let instant = new Date(wallClockAsUtc);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = new Date(wallClockAsUtc - pacificOffsetMilliseconds(instant));
    if (next.getTime() === instant.getTime()) return next;
    instant = next;
  }
  throw new TypeError('Pacific date boundary could not be resolved');
}

function present(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function explicitFlag(value) {
  if (value === true) return 'test';
  if (value === false) return 'non_test';
  return 'missing';
}

function reference(value) {
  return present(value) ? value.trim() : null;
}

function validPostalFormat(address) {
  const country = typeof address?.country === 'string' ? address.country.trim().toUpperCase() : '';
  const code = typeof address?.postal_code === 'string' ? address.postal_code.trim().toUpperCase() : '';
  if (country === 'US') return /^\d{5}(?:-?\d{4})?$/.test(code);
  if (country === 'CA') return /^[A-Z]\d[A-Z][ -]?\d[A-Z]\d$/.test(code);
  return false;
}

function emptyCoverage() {
  return Object.fromEntries(BILLING_FIELDS.map((field) => [field, {
    purchase_rows_present: 0,
    distinct_purchasers_present: 0,
  }]));
}

/**
 * Return only aggregate coverage from temporary projected purchase rows.
 * Stripe/application identifiers and full billing fields are never copied into the result.
 */
export async function summarizeStripeHistoryAuditRows(rows, filters, generatedAt = new Date()) {
  const counts = {
    local_purchase_rows: 0,
    completed_paid_nonzero_local_rows: 0,
    zero_or_unknown_amount_rows: 0,
    explicit_purchase_test_rows: 0,
    explicit_purchase_non_test_rows: 0,
    missing_purchase_test_flag_rows: 0,
    explicit_user_test_rows: 0,
    explicit_user_non_test_rows: 0,
    missing_or_unmatched_user_test_flag_rows: 0,
    explicit_flag_conflict_rows: 0,
    app_candidate_business_purchase_rows: 0,
    app_candidate_business_distinct_purchasers: 0,
    app_candidate_business_rows_with_missing_test_flag: 0,
  };
  const checkout = {
    candidate_rows_with_reference: 0,
    candidate_rows_without_reference: 0,
    distinct_candidate_references: 0,
    duplicate_candidate_reference_groups: 0,
    candidate_rows_in_duplicate_groups: 0,
  };
  const refund = {
    paid_rows_with_local_full_refund_marker: 0,
    paid_rows_with_local_partial_refund_marker: 0,
    paid_rows_without_local_refund_marker: 0,
    stripe_refund_status_verified: false,
  };
  const billing = emptyCoverage();
  billing.postal_code.purchase_rows_recognized_us_or_ca_format = 0;
  billing.postal_code.distinct_purchasers_recognized_us_or_ca_format = 0;
  const purchaserKeys = new Set();
  const sessionCounts = new Map();
  const purchasersWithField = Object.fromEntries(BILLING_FIELDS.map((field) => [field, new Set()]));
  const purchasersWithValidPostal = new Set();

  for await (const row of rows) {
    counts.local_purchase_rows += 1;
    if (counts.local_purchase_rows > MAX_AUDIT_ROWS) {
      throw new TypeError('historical audit row limit exceeded; no partial report was returned');
    }
    const amountPaid = typeof row.amount === 'number' && Number.isFinite(row.amount) && row.amount > 0;
    const purchaseFlag = explicitFlag(row.purchaseIsTest);
    const userFlag = row.userMatched ? explicitFlag(row.userIsTest) : 'missing';
    if (amountPaid) counts.completed_paid_nonzero_local_rows += 1;
    else counts.zero_or_unknown_amount_rows += 1;
    counts[{
      test: 'explicit_purchase_test_rows',
      non_test: 'explicit_purchase_non_test_rows',
      missing: 'missing_purchase_test_flag_rows',
    }[purchaseFlag]] += 1;
    counts[{
      test: 'explicit_user_test_rows',
      non_test: 'explicit_user_non_test_rows',
      missing: 'missing_or_unmatched_user_test_flag_rows',
    }[userFlag]] += 1;
    if (purchaseFlag !== 'missing' && userFlag !== 'missing' && purchaseFlag !== userFlag) {
      counts.explicit_flag_conflict_rows += 1;
    }
    const fullRefund = row.fullyRefundedAt != null;
    const partialRefund = row.lastRefundPartialAt != null;
    if (amountPaid) {
      if (fullRefund) refund.paid_rows_with_local_full_refund_marker += 1;
      if (partialRefund) refund.paid_rows_with_local_partial_refund_marker += 1;
      if (!fullRefund && !partialRefund) refund.paid_rows_without_local_refund_marker += 1;
    }
    // Mirrors current application qualification but visibly counts missing legacy flags.
    const candidate = amountPaid && row.userMatched === true && row.userId != null &&
      purchaseFlag !== 'test' && userFlag !== 'test' && !fullRefund;
    if (!candidate) continue;
    counts.app_candidate_business_purchase_rows += 1;
    if (purchaseFlag === 'missing' || userFlag === 'missing') {
      counts.app_candidate_business_rows_with_missing_test_flag += 1;
    }
    const purchaserKey = String(row.userId);
    purchaserKeys.add(purchaserKey);
    const sessionKey = reference(row.stripeSessionId);
    if (sessionKey) {
      checkout.candidate_rows_with_reference += 1;
      sessionCounts.set(sessionKey, (sessionCounts.get(sessionKey) || 0) + 1);
    } else checkout.candidate_rows_without_reference += 1;
    const address = row.billingAddress ?? {};
    for (const field of BILLING_FIELDS) {
      if (!present(address[field])) continue;
      billing[field].purchase_rows_present += 1;
      purchasersWithField[field].add(purchaserKey);
    }
    if (validPostalFormat(address)) {
      billing.postal_code.purchase_rows_recognized_us_or_ca_format += 1;
      purchasersWithValidPostal.add(purchaserKey);
    }
  }
  counts.app_candidate_business_distinct_purchasers = purchaserKeys.size;
  checkout.distinct_candidate_references = sessionCounts.size;
  for (const count of sessionCounts.values()) {
    if (count > 1) {
      checkout.duplicate_candidate_reference_groups += 1;
      checkout.candidate_rows_in_duplicate_groups += count;
    }
  }
  for (const field of BILLING_FIELDS) {
    billing[field].distinct_purchasers_present = purchasersWithField[field].size;
  }
  billing.postal_code.distinct_purchasers_recognized_us_or_ca_format = purchasersWithValidPostal.size;

  return {
    schema_version: STRIPE_HISTORY_AUDIT_SCHEMA_VERSION,
    source: STRIPE_HISTORY_AUDIT_SOURCE,
    window: {
      start_date: filters.start.toISOString().slice(0, 10),
      end_date: filters.end.toISOString().slice(0, 10),
      time_zone: PACIFIC_TIME_ZONE,
    },
    generated_at: generatedAt.toISOString(),
    export_context: {
      campaign_id: filters.campaignId,
      neutral_export: true,
      raw_export_approved: false,
      raw_export_accepted_by_tidy: false,
    },
    privacy: {
      customer_rows_emitted: false,
      direct_identifiers_emitted: false,
      full_postal_codes_emitted: false,
      credentials_emitted: false,
    },
    execution: { dry_run: true, records_modified: false, live_stripe_read: false },
    counts,
    checkout_reference_coverage: checkout,
    local_refund_marker_coverage: refund,
    billing_field_coverage: billing,
    limitations: [
      'Checkout reference presence is not a verified match to Stripe.',
      'Local refund markers have not been reconciled with Stripe refund state.',
      'Legacy missing test flags may be counted by the current app purchase definition but are not independently verified as production.',
      'Billing fields were checked only for presence and recognized US/Canadian postal format; no buyer-geography groups or customer rows were exported.',
    ],
  };
}

export async function getSsmfStripeHistoryAudit(db, rawFilters, now = new Date()) {
  const filters = parseSsmfBaselineFilters(rawFilters, now);
  if (filters.end.toISOString().slice(0, 10) > pacificDateString(now)) {
    throw new TypeError('date range must be ordered, no more than 365 inclusive days, and not in the future');
  }
  const startUtc = pacificDayStartUtc(filters.start);
  const endExclusiveUtc = pacificDayStartUtc(new Date(filters.end.getTime() + 24 * 60 * 60 * 1000));
  const cursor = db.collection('purchases').aggregate([
    { $match: { createdAt: { $gte: startUtc, $lt: endExclusiveUtc } } },
    { $lookup: {
      from: 'users', localField: 'userId', foreignField: '_id',
      pipeline: [{ $project: { _id: 0, isTest: 1 } }], as: 'matchedUser',
    } },
    { $project: {
      _id: 0,
      userId: 1,
      stripeSessionId: 1,
      amount: 1,
      purchaseIsTest: '$isTest',
      userMatched: { $gt: [{ $size: '$matchedUser' }, 0] },
      userIsTest: { $arrayElemAt: ['$matchedUser.isTest', 0] },
      fullyRefundedAt: 1,
      lastRefundPartialAt: 1,
      billingAddress: {
        country: '$customerDetails.address.country',
        state: '$customerDetails.address.state',
        city: '$customerDetails.address.city',
        postal_code: '$customerDetails.address.postal_code',
      },
    } },
  ], { maxTimeMS: 10_000 });
  try {
    return await summarizeStripeHistoryAuditRows(cursor, filters, now);
  } finally {
    if (typeof cursor.close === 'function') await cursor.close();
  }
}
