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
 * Allowlisted sort keys → MongoDB sort documents.
 * Always include `_id` as a deterministic tie-breaker.
 * Does not sort by Status (composite) or sensitive fields.
 */
export const SORT_SPECS = Object.freeze({
  created_desc: { createdAt: -1, _id: -1 },
  created_asc: { createdAt: 1, _id: 1 },
  name_asc: { firstName: 1, lastName: 1, _id: 1 },
  name_desc: { firstName: -1, lastName: -1, _id: -1 },
  email_asc: { email: 1, _id: 1 },
  email_desc: { email: -1, _id: -1 },
});

export const SORT_LABELS = Object.freeze({
  created_desc: 'Newest created first',
  created_asc: 'Oldest created first',
  name_asc: 'Name A to Z',
  name_desc: 'Name Z to A',
  email_asc: 'Email A to Z',
  email_desc: 'Email Z to A',
});

export function resolveSortKey(sort) {
  if (typeof sort === 'string' && Object.prototype.hasOwnProperty.call(SORT_SPECS, sort)) {
    return sort;
  }
  return DEFAULT_SORT;
}

export function resolveSortSpec(sort) {
  return SORT_SPECS[resolveSortKey(sort)];
}

/**
 * Page size: exact approved values preferred by the UI; any integer 1–200 is
 * accepted by the API; oversized values clamp to 200; invalid → 25.
 */
export function resolveLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGE_SIZE;
  const floor = Math.floor(n);
  if (floor > MAX_PAGE_SIZE) return MAX_PAGE_SIZE;
  return floor;
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
  // Keep a little context near ends
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
 * Omits empty query; always includes page/limit/sort for round-trips.
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
 * @param {string[]} stack query strings
 * @param {number} index current index
 * @param {'back'|'forward'} direction
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
    } else {
      av = (av == null ? '' : String(av)).toLowerCase();
      bv = (bv == null ? '' : String(bv)).toLowerCase();
    }
    if (av < bv) return -dir;
    if (av > bv) return dir;
  }
  return 0;
}
