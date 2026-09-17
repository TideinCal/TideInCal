/**
 * Shared allowlists and clamping for the admin customer list.
 * Pure helpers — safe to unit-test without MongoDB or a browser.
 */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;
export const ALLOWED_PAGE_SIZES = Object.freeze([25, 50, 100, 200]);
export const DEFAULT_SORT = 'created_desc';

/** Each Stripe/text search strategy caps matches at this size (documented limitation). */
export const SEARCH_STRATEGY_MATCH_CAP = 50;

/**
 * Field sorts → MongoDB sort documents (browse uses find().sort()).
 * Always include `_id` as a deterministic tie-breaker.
 */
export const FIELD_SORT_SPECS = Object.freeze({
  created_desc: { createdAt: -1, _id: -1 },
  created_asc: { createdAt: 1, _id: 1 },
  name_asc: { firstName: 1, lastName: 1, _id: 1 },
  name_desc: { firstName: -1, lastName: -1, _id: -1 },
  email_asc: { email: 1, _id: 1 },
  email_desc: { email: -1, _id: -1 },
});

/**
 * Status sorts: group by computed business status, then newest + `_id` desc within group.
 * Reverse choices only flip the status group order.
 */
export const STATUS_SORT_KEYS = Object.freeze([
  'verified_first',
  'unverified_first',
  'paying_first',
  'nonpaying_first',
  'active_first',
  'inactive_first',
]);

/** @deprecated use FIELD_SORT_SPECS + STATUS_SORT_KEYS; kept as combined allowlist */
export const SORT_SPECS = Object.freeze({
  ...FIELD_SORT_SPECS,
  // Status sorts are handled via aggregation / computed ranks, not plain field specs.
  verified_first: { _statusRank: 1, createdAt: -1, _id: -1 },
  unverified_first: { _statusRank: 1, createdAt: -1, _id: -1 },
  paying_first: { _statusRank: 1, createdAt: -1, _id: -1 },
  nonpaying_first: { _statusRank: 1, createdAt: -1, _id: -1 },
  active_first: { _statusRank: 1, createdAt: -1, _id: -1 },
  inactive_first: { _statusRank: 1, createdAt: -1, _id: -1 },
});

export const SORT_LABELS = Object.freeze({
  created_desc: 'Newest created first',
  created_asc: 'Oldest created first',
  name_asc: 'Name A to Z',
  name_desc: 'Name Z to A',
  email_asc: 'Email A to Z',
  email_desc: 'Email Z to A',
  verified_first: 'Verified first',
  unverified_first: 'Unverified first',
  paying_first: 'Paying first',
  nonpaying_first: 'Non-paying first',
  active_first: 'Active subscribers first',
  inactive_first: 'No active subscription first',
});

export function isStatusSort(sort) {
  return STATUS_SORT_KEYS.includes(resolveSortKey(sort));
}

export function resolveSortKey(sort) {
  if (typeof sort === 'string' && Object.prototype.hasOwnProperty.call(SORT_SPECS, sort)) {
    return sort;
  }
  return DEFAULT_SORT;
}

export function resolveSortSpec(sort) {
  const key = resolveSortKey(sort);
  if (isStatusSort(key)) {
    return { _statusRank: 1, createdAt: -1, _id: -1 };
  }
  return FIELD_SORT_SPECS[key] || FIELD_SORT_SPECS[DEFAULT_SORT];
}

/**
 * Which status boolean drives `_statusRank` for a status sort key.
 * Prefer-true sorts put true → 0; reverse sorts put true → 1.
 */
export function statusSortConfig(sortKey) {
  const key = resolveSortKey(sortKey);
  switch (key) {
    case 'verified_first':
      return { flag: 'emailVerified', preferTrue: true };
    case 'unverified_first':
      return { flag: 'emailVerified', preferTrue: false };
    case 'paying_first':
      return { flag: 'payingCustomer', preferTrue: true };
    case 'nonpaying_first':
      return { flag: 'payingCustomer', preferTrue: false };
    case 'active_first':
      return { flag: 'subscriptionActive', preferTrue: true };
    case 'inactive_first':
      return { flag: 'subscriptionActive', preferTrue: false };
    default:
      return null;
  }
}

/** Status rank: 0 = preferred group, 1 = other group. */
export function statusRankForFlag(flagValue, preferTrue) {
  const truthy = !!flagValue;
  if (preferTrue) return truthy ? 0 : 1;
  return truthy ? 1 : 0;
}

/**
 * Only the four visible page sizes are valid. Anything else → 25.
 */
export function resolveLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGE_SIZE;
  const floor = Math.floor(n);
  // Fractional values (e.g. 25.5, 50.1) are not exact allowlist sizes → default.
  if (n !== floor) return DEFAULT_PAGE_SIZE;
  if (ALLOWED_PAGE_SIZES.includes(floor)) return floor;
  return DEFAULT_PAGE_SIZE;
}

/** Raw page request → positive integer (before total-based clamp). */
export function resolveRequestedPage(page) {
  const n = Number(page);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

/**
 * Clamp page into [1, totalPages]. Empty dataset → page 1, totalPages 0.
 */
export function resolveEffectivePage(requestedPage, total, limit) {
  const limitNum = resolveLimit(limit);
  const totalPages = total === 0 ? 0 : Math.ceil(total / limitNum);
  let page = resolveRequestedPage(requestedPage);
  if (totalPages === 0) return 1;
  if (page > totalPages) return totalPages;
  return page;
}

export function buildPaginationMeta({ page, limit, total, sort }) {
  const limitNum = resolveLimit(limit);
  const sortKey = resolveSortKey(sort);
  const totalPages = total === 0 ? 0 : Math.ceil(total / limitNum);
  const pageNum = resolveEffectivePage(page, total, limitNum);
  return {
    page: pageNum,
    limit: limitNum,
    total,
    totalPages,
    sort: sortKey,
    hasPrevious: pageNum > 1 && total > 0,
    hasNext: totalPages > 0 && pageNum < totalPages,
    hasFirst: pageNum > 1 && total > 0,
    hasLast: totalPages > 0 && pageNum < totalPages,
  };
}

/**
 * Compact page window for numbered buttons: always includes 1 and last,
 * a sibling window around current, with null markers for ellipses.
 */
export function buildPageWindow(currentPage, totalPages, { siblingCount = 1 } = {}) {
  if (totalPages <= 0) return [];
  if (totalPages <= 9) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages = new Set([1, totalPages, currentPage]);
  for (let i = 1; i <= siblingCount; i += 1) {
    pages.add(currentPage - i);
    pages.add(currentPage + i);
  }
  pages.add(2);
  pages.add(totalPages - 1);

  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push(null);
    out.push(p);
    prev = p;
  }
  return out;
}

/** Navigation enablement for First / Previous / Next / Last. */
export function navControlState(page, totalPages) {
  const empty = totalPages <= 0;
  return {
    firstDisabled: empty || page <= 1,
    previousDisabled: empty || page <= 1,
    nextDisabled: empty || page >= totalPages,
    lastDisabled: empty || page >= totalPages,
  };
}

/**
 * Parse list state from a URLSearchParams or query string.
 */
export function parseListState(input) {
  const params =
    typeof input === 'string'
      ? new URLSearchParams(input.startsWith('?') ? input.slice(1) : input)
      : input instanceof URLSearchParams
        ? input
        : new URLSearchParams();

  return {
    query: params.get('query') || '',
    page: resolveRequestedPage(params.get('page')),
    limit: resolveLimit(params.get('limit')),
    sort: resolveSortKey(params.get('sort')),
  };
}

/**
 * Serialize list state to a query string (no leading ?).
 */
export function serializeListState({ query = '', page = 1, limit = DEFAULT_PAGE_SIZE, sort = DEFAULT_SORT } = {}) {
  const params = new URLSearchParams();
  const q = (query || '').trim();
  if (q) params.set('query', q);
  params.set('page', String(resolveRequestedPage(page)));
  params.set('limit', String(resolveLimit(limit)));
  params.set('sort', resolveSortKey(sort));
  return params.toString();
}

/**
 * Simulate history stack navigation for Back/Forward tests.
 */
export function navigateHistory(stack, index, direction) {
  if (!Array.isArray(stack) || stack.length === 0) {
    return { index: 0, state: parseListState('') };
  }
  let next = index;
  if (direction === 'back') next = Math.max(0, index - 1);
  if (direction === 'forward') next = Math.min(stack.length - 1, index + 1);
  return { index: next, state: parseListState(stack[next]) };
}

/**
 * Compare two user docs using a Mongo-style sort spec (for in-memory search results).
 */
export function compareBySortSpec(a, b, sortSpec) {
  for (const [field, dir] of Object.entries(sortSpec)) {
    let av = a[field];
    let bv = b[field];
    if (field === 'createdAt') {
      av = av ? new Date(av).getTime() : 0;
      bv = bv ? new Date(bv).getTime() : 0;
    } else if (field === '_id') {
      av = String(av);
      bv = String(bv);
    } else if (field === '_statusRank') {
      av = Number(av) || 0;
      bv = Number(bv) || 0;
    } else {
      av = (av == null ? '' : String(av)).toLowerCase();
      bv = (bv == null ? '' : String(bv)).toLowerCase();
    }
    if (av < bv) return -dir;
    if (av > bv) return dir;
  }
  return 0;
}

/**
 * Business status flags matching list badges / dashboard definitions.
 * Test users are never paying or active-subscriber for status sorting.
 */
export function computeBusinessStatusFlags(user, { isPaying = false, now = new Date() } = {}) {
  const isTest = user?.isTest === true;
  const emailVerified =
    user?.emailVerifiedAt instanceof Date && !Number.isNaN(user.emailVerifiedAt.getTime());
  const periodEnd = user?.subscriptionCurrentPeriodEnd
    ? new Date(user.subscriptionCurrentPeriodEnd)
    : null;
  const subscriptionActive =
    !isTest &&
    user?.subscriptionStatus === 'active' &&
    periodEnd instanceof Date &&
    !Number.isNaN(periodEnd.getTime()) &&
    periodEnd > now;
  const payingCustomer = !isTest && !!isPaying;
  return { isTest, emailVerified, payingCustomer, subscriptionActive };
}
