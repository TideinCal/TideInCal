import { sanitizeSlug } from '../attribution/index.js';
import { VERIFICATION_IDENTIFIERS } from './index.js';

const MAX_REPORT_DAYS = 31;

export function parseCampaignReportFilters({ campaign, start, end }, now = new Date()) {
  const cleanCampaign = sanitizeSlug(campaign);
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (!cleanCampaign || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new TypeError('campaign, start, and end are required');
  }
  if (endDate <= startDate || endDate > now || endDate - startDate > MAX_REPORT_DAYS * 86400000) {
    throw new TypeError('date range must be positive, no more than 31 days, and not in the future');
  }
  return { campaign: cleanCampaign, start: startDate, end: endDate };
}

function currencyMap(rows, field) {
  return Object.fromEntries(rows.map((row) => [row._id || 'unknown', row[field] || 0]));
}

function percentage(numerator, denominator) {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(2)) : 0;
}

export function buildEventReportPipeline(filters) {
  return [
    { $match: {
      $and: [
        { campaign: filters.campaign },
        { campaign: { $nin: VERIFICATION_IDENTIFIERS } },
      ],
      serverTimestamp: { $gte: filters.start, $lt: filters.end },
      isTest: { $ne: true },
      content: { $nin: VERIFICATION_IDENTIFIERS },
    } },
    { $facet: {
      tagged: [{ $match: { eventName: 'tagged_landing' } }, { $group: { _id: '$journeyId' } }, { $count: 'count' }],
      selected: [{ $match: { eventName: 'product_selected' } }, { $group: { _id: '$journeyId' } }, { $count: 'count' }],
      signups: [{ $match: { eventName: 'signup_completed' } }, { $count: 'count' }],
      checkout: [{ $match: { eventName: 'checkout_started' } }, { $group: { _id: '$journeyId' } }, { $count: 'count' }],
    } },
  ];
}

export function buildPurchaseReportPipeline(filters) {
  return [
    { $match: {
      $and: [
        { 'attribution.campaign': filters.campaign },
        { 'attribution.campaign': { $nin: VERIFICATION_IDENTIFIERS } },
      ],
      createdAt: { $gte: filters.start, $lt: filters.end },
      isTest: { $ne: true },
      userId: { $type: 'objectId' },
      amount: { $type: 'number', $gt: 0 },
      'attribution.content': { $nin: VERIFICATION_IDENTIFIERS },
    } },
    { $facet: {
      paying: [
        // KPI: a window purchaser is new only when no earlier qualifying paid
        // purchase exists for that user. Prior fully-refunded-only rows do not disqualify.
        { $match: { $or: [{ fullyRefundedAt: { $exists: false } }, { fullyRefundedAt: null }] } },
        { $group: { _id: '$userId' } },
        { $lookup: {
          from: 'purchases',
          let: { candidateUserId: '$_id' },
          pipeline: [
            { $match: { $expr: { $and: [
              { $eq: ['$userId', '$$candidateUserId'] },
              { $lt: ['$createdAt', filters.start] },
              { $isNumber: '$amount' },
              { $gt: ['$amount', 0] },
              { $ne: [{ $ifNull: ['$isTest', false] }, true] },
              { $eq: [{ $ifNull: ['$fullyRefundedAt', null] }, null] },
            ] } } },
            { $limit: 1 },
          ],
          as: 'priorPaidPurchases',
        } },
        { $match: { $expr: { $eq: [{ $size: '$priorPaidPurchases' }, 0] } } },
        { $count: 'customers' },
      ],
      completed: [
        { $group: { _id: null, purchases: { $sum: 1 }, subscriptions: { $sum: { $cond: [{ $eq: ['$product', 'subscription'] }, 1, 0] } } } },
        { $project: { _id: 0, purchases: 1, subscriptions: 1 } },
      ],
      money: [
        { $group: { _id: '$currency', gross: { $sum: '$amount' }, refunds: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$fullyRefundedAt', null] }, null] }, '$amount', { $ifNull: ['$refundedAmount', 0] }] } } } },
        { $project: { gross: 1, refunds: 1, net: { $subtract: ['$gross', '$refunds'] } } },
      ],
    } },
  ];
}

export async function getCampaignFunnelReport(db, rawFilters, now = new Date()) {
  const filters = parseCampaignReportFilters(rawFilters, now);
  const [eventSummary = {}] = await db.collection('funnel_events')
    .aggregate(buildEventReportPipeline(filters)).toArray();
  const [purchaseSummary = {}] = await db.collection('purchases')
    .aggregate(buildPurchaseReportPipeline(filters)).toArray();

  const paying = purchaseSummary.paying?.[0] || {};
  const completed = purchaseSummary.completed?.[0] || {};
  const money = purchaseSummary.money || [];
  const counts = {
    taggedJourneys: eventSummary.tagged?.[0]?.count || 0,
    selectedJourneys: eventSummary.selected?.[0]?.count || 0,
    completedSignups: eventSummary.signups?.[0]?.count || 0,
    checkoutJourneys: eventSummary.checkout?.[0]?.count || 0,
    payingCustomers: paying.customers || 0,
    completedPurchases: completed.purchases || 0,
    proSubscriptionsStarted: completed.subscriptions || 0,
  };

  return {
    filters,
    ...counts,
    grossByCurrency: currencyMap(money, 'gross'),
    refundsByCurrency: currencyMap(money, 'refunds'),
    netByCurrency: currencyMap(money, 'net'),
    conversionPercentages: {
      landingToSelection: percentage(counts.selectedJourneys, counts.taggedJourneys),
      selectionToSignup: percentage(counts.completedSignups, counts.selectedJourneys),
      signupToCheckout: percentage(counts.checkoutJourneys, counts.completedSignups),
      checkoutToPayingCustomer: percentage(counts.payingCustomers, counts.checkoutJourneys),
    },
  };
}
