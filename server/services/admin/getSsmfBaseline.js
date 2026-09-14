import { VERIFICATION_IDENTIFIERS } from '../../funnel/index.js';
import { BUSINESS_USER_FILTER, PAYING_PURCHASE_MATCH } from './getDashboardData.js';

export const SSMF_BASELINE_SCHEMA_VERSION = 1;
export const SSMF_MINIMUM_GROUP_SIZE = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 365;
const ANONYMOUS_FUNNEL_RETENTION_DAYS = 90;
const SAFE_CAMPAIGN_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROPOSED_USES = Object.freeze([
  'summarize_baseline',
  'compare_over_time',
  'inform_content_mix',
  'set_measurement_plan',
]);

function parseDateOnly(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${field} must be a YYYY-MM-DD date`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new TypeError(`${field} must be a valid calendar date`);
  }
  return date;
}

function utcTodayStart(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * The campaign id is export context, never approval identity. The downstream
 * safe form uses lowercase alphanumeric segments separated only by hyphens.
 */
export function parseSsmfBaselineFilters({ campaign_id: campaignId, start, end }, now = new Date()) {
  if (typeof campaignId !== 'string' || campaignId.length > 80 || !SAFE_CAMPAIGN_ID_RE.test(campaignId)) {
    throw new TypeError('campaign_id must use lowercase alphanumeric segments separated by hyphens');
  }

  const startDate = parseDateOnly(start, 'start');
  const endDate = parseDateOnly(end, 'end');
  const today = utcTodayStart(now);
  const inclusiveDays = Math.floor((endDate - startDate) / DAY_MS) + 1;
  if (endDate < startDate || endDate > today || inclusiveDays > MAX_RANGE_DAYS) {
    throw new TypeError('date range must be ordered, no more than 365 inclusive days, and not in the future');
  }

  return {
    campaignId,
    start: startDate,
    end: endDate,
    endInclusive: new Date(endDate.getTime() + DAY_MS - 1),
    inclusiveDays,
  };
}

function dateMatch(field, filters) {
  return { [field]: { $gte: filters.start, $lte: filters.endInclusive } };
}

function totalValue(name, value) {
  return { name, available: true, value, unavailable_reason: null };
}

function unavailableTotal(name, reason) {
  return { name, available: false, value: null, unavailable_reason: reason };
}

function groupedValue(name, rows = []) {
  const visibleGroups = [];
  let suppressedRecords = 0;
  for (const row of rows) {
    const count = row.count || 0;
    if (count >= SSMF_MINIMUM_GROUP_SIZE) {
      visibleGroups.push([String(row._id || 'unknown'), count]);
    } else {
      suppressedRecords += count;
    }
  }
  return {
    name,
    available: true,
    groups: Object.fromEntries(visibleGroups.sort(([a], [b]) => a.localeCompare(b))),
    suppressed_records: suppressedRecords,
    minimum_group_size: SSMF_MINIMUM_GROUP_SIZE,
    unavailable_reason: null,
  };
}

export function buildQualifyingPurchasePipeline(filters) {
  return [
    { $match: { ...PAYING_PURCHASE_MATCH, ...dateMatch('createdAt', filters) } },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: '$user' },
    { $match: { 'user.isTest': { $ne: true } } },
    {
      $facet: {
        paying_customers: [{ $group: { _id: '$userId' } }, { $count: 'count' }],
        completed_local_purchases: [{ $count: 'count' }],
        product_demand: [
          { $project: { key: { $ifNull: ['$product', 'unknown'] } } },
          { $group: { _id: '$key', count: { $sum: 1 } } },
        ],
        station_country_demand: [
          {
            $project: {
              key: {
                $ifNull: [
                  '$selectedStation.country',
                  { $ifNull: ['$regenerationParams.country', 'unknown'] },
                ],
              },
            },
          },
          { $group: { _id: '$key', count: { $sum: 1 } } },
        ],
        selected_station_demand: [
          {
            $project: {
              key: {
                $ifNull: [
                  '$selectedStation.stationId',
                  { $ifNull: ['$regenerationParams.stationId', 'unknown'] },
                ],
              },
            },
          },
          { $group: { _id: '$key', count: { $sum: 1 } } },
        ],
        attribution_source: [
          { $project: { key: { $ifNull: ['$attribution.source', 'unknown'] } } },
          { $group: { _id: '$key', count: { $sum: 1 } } },
        ],
      },
    },
  ];
}

export function buildCheckoutStartedPipeline(filters) {
  return [
    {
      $match: {
        ...dateMatch('serverTimestamp', filters),
        eventName: 'checkout_started',
        isTest: { $ne: true },
        $and: [
          { campaign: filters.campaignId },
          { campaign: { $nin: VERIFICATION_IDENTIFIERS } },
        ],
        content: { $nin: VERIFICATION_IDENTIFIERS },
      },
    },
    { $group: { _id: '$journeyId' } },
    { $count: 'count' },
  ];
}

async function aggregateFirst(db, collection, pipeline) {
  const rows = await db.collection(collection).aggregate(pipeline).toArray();
  return rows[0] || {};
}

/**
 * A strictly allowlisted aggregate export. No documents or direct identifiers
 * leave MongoDB; all output is counts, safe group labels, and metadata.
 */
export async function getSsmfBaseline(db, rawFilters, now = new Date()) {
  const filters = parseSsmfBaselineFilters(rawFilters, now);
  const [registeredAccounts, verifiedEmailAccounts, purchaseSummary] = await Promise.all([
    db.collection('users').countDocuments({ ...BUSINESS_USER_FILTER, ...dateMatch('createdAt', filters) }),
    db.collection('users').countDocuments({
      ...BUSINESS_USER_FILTER,
      ...dateMatch('emailVerifiedAt', filters),
      emailVerifiedAt: { $type: 'date', ...dateMatch('emailVerifiedAt', filters).emailVerifiedAt },
    }),
    aggregateFirst(db, 'purchases', buildQualifyingPurchasePipeline(filters)),
  ]);

  const anonymousRetentionStart = new Date(now.getTime() - ANONYMOUS_FUNNEL_RETENTION_DAYS * DAY_MS);
  const checkoutStarted = filters.start >= anonymousRetentionStart
    ? await aggregateFirst(db, 'funnel_events', buildCheckoutStartedPipeline(filters))
    : null;

  const completedPurchases = purchaseSummary.completed_local_purchases?.[0]?.count || 0;
  return {
    schema_version: SSMF_BASELINE_SCHEMA_VERSION,
    source: 'tide_app_aggregate',
    window: {
      start_date: rawFilters.start,
      end_date: rawFilters.end,
    },
    totals: [
      totalValue('registered_accounts', registeredAccounts),
      totalValue('verified_email_accounts', verifiedEmailAccounts),
      totalValue('paying_customers', purchaseSummary.paying_customers?.[0]?.count || 0),
      unavailableTotal('active_subscribers', 'not_supported'),
      totalValue('completed_local_purchases', completedPurchases),
      unavailableTotal('downloads', 'insufficient_history'),
      checkoutStarted
        ? totalValue('checkout_started', checkoutStarted.count || 0)
        : unavailableTotal('checkout_started', 'insufficient_history'),
      totalValue('checkout_completed', completedPurchases),
    ],
    grouped_counts: [
      groupedValue('product_demand', purchaseSummary.product_demand),
      groupedValue('station_country_demand', purchaseSummary.station_country_demand),
      groupedValue('selected_station_demand', purchaseSummary.selected_station_demand),
      groupedValue('attribution_source', purchaseSummary.attribution_source),
    ],
    privacy: {
      customer_rows_emitted: false,
      direct_identifiers_emitted: false,
      minimum_group_size: SSMF_MINIMUM_GROUP_SIZE,
    },
    limitations: [
      'Active subscribers are historically unavailable because only current subscription state is stored.',
      'Legacy user records without createdAt are not counted in the date-bounded registered-account total.',
      'Downloads are unavailable because stored download counters are cumulative and do not provide a reliable dated event history.',
      'Anonymous checkout funnel events expire after 90 days; checkout_started is unavailable for ranges beginning before that retention window.',
      'Checkout funnel events require attribution and can omit unattributed checkout sessions.',
      'Historical attribution and station fields may be absent on legacy purchase records and are grouped as unknown when present in qualifying records.',
    ],
    proposed_uses: [...PROPOSED_USES],
    export_context: {
      neutral_export: true,
      raw_export_approved: false,
      raw_export_accepted_by_tidy: false,
      campaign_id: filters.campaignId,
      inclusive_days: filters.inclusiveDays,
      tidy_wrapper_required: {
        name: 'tide_app_aggregate_ssmf_v1',
        requirements: [
          'Inject separately recorded Joe approval metadata.',
          'Inject separately recorded collection provenance.',
          'Submit the resulting wrapped evidence to the Tidy validator.',
        ],
        validation_binding: {
          schema_version: SSMF_BASELINE_SCHEMA_VERSION,
          source: 'tide_app_aggregate',
          window: {
            start_date: rawFilters.start,
            end_date: rawFilters.end,
          },
          campaign_id: filters.campaignId,
        },
      },
    },
  };
}
