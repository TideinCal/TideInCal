import { describe, it, expect } from 'vitest';
import {
  ALLOWED_PAGE_SIZES,
  DEFAULT_SORT,
  FIELD_SORT_SPECS,
  SORT_SPECS,
  STATUS_SORT_KEYS,
  buildPageWindow,
  buildPaginationMeta,
  computeBusinessStatusFlags,
  navigateHistory,
  navControlState,
  parseListState,
  resolveEffectivePage,
  resolveLimit,
  resolveSortKey,
  serializeListState,
  statusRankForFlag,
  statusSortConfig,
} from '../customerListParams.js';

describe('customerListParams', () => {
  it('allowlists field and status sorts and falls back to newest-first', () => {
    expect(resolveSortKey('created_asc')).toBe('created_asc');
    expect(resolveSortKey('email_desc')).toBe('email_desc');
    expect(resolveSortKey('verified_first')).toBe('verified_first');
    expect(resolveSortKey('paying_first')).toBe('paying_first');
    expect(resolveSortKey('active_first')).toBe('active_first');
    expect(resolveSortKey('status_asc')).toBe(DEFAULT_SORT);
    expect(resolveSortKey(undefined)).toBe(DEFAULT_SORT);
    expect(FIELD_SORT_SPECS.created_desc).toEqual({ createdAt: -1, _id: -1 });
    expect(FIELD_SORT_SPECS.name_asc).toEqual({ firstName: 1, lastName: 1, _id: 1 });
    for (const key of STATUS_SORT_KEYS) {
      expect(SORT_SPECS[key]).toEqual({ _statusRank: 1, createdAt: -1, _id: -1 });
      expect(statusSortConfig(key)).not.toBeNull();
    }
  });

  it('accepts exactly 25, 50, 100, and 200; everything else becomes 25', () => {
    for (const size of ALLOWED_PAGE_SIZES) {
      expect(resolveLimit(size)).toBe(size);
      expect(resolveLimit(String(size))).toBe(size);
    }
    for (const bad of [1, 10, 75, 199, 201, 500, 9999, 0, -10, 25.5, 50.1, 'nope', '', null, undefined]) {
      expect(resolveLimit(bad)).toBe(25);
    }
  });

  it('URL parsing and pagination metadata always return one of the four visible page sizes', () => {
    expect(parseListState('?limit=75')).toMatchObject({ limit: 25 });
    expect(parseListState('?limit=199')).toMatchObject({ limit: 25 });
    expect(parseListState('?limit=25.9')).toMatchObject({ limit: 25 });
    expect(parseListState('?limit=100')).toMatchObject({ limit: 100 });
    expect(serializeListState({ limit: 75 })).toContain('limit=25');
    expect(serializeListState({ limit: 200 })).toContain('limit=200');

    const meta = buildPaginationMeta({ page: 1, limit: 75, total: 100, sort: 'created_desc' });
    expect(ALLOWED_PAGE_SIZES).toContain(meta.limit);
    expect(meta.limit).toBe(25);
  });

  it('status rank prefers the badge-matching group; reverse only flips groups', () => {
    expect(statusRankForFlag(true, true)).toBe(0);
    expect(statusRankForFlag(false, true)).toBe(1);
    expect(statusRankForFlag(true, false)).toBe(1);
    expect(statusRankForFlag(false, false)).toBe(0);
  });

  it('computeBusinessStatusFlags matches badge definitions including test exclusion', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const verified = computeBusinessStatusFlags(
      { emailVerifiedAt: new Date('2026-01-01'), isTest: false },
      { isPaying: true, now }
    );
    expect(verified.emailVerified).toBe(true);
    expect(verified.payingCustomer).toBe(true);

    const invalidDate = computeBusinessStatusFlags(
      { emailVerifiedAt: new Date('not-a-date'), isTest: false },
      { isPaying: false, now }
    );
    expect(invalidDate.emailVerified).toBe(false);

    const testUser = computeBusinessStatusFlags(
      {
        isTest: true,
        emailVerifiedAt: new Date('2026-01-01'),
        subscriptionStatus: 'active',
        subscriptionCurrentPeriodEnd: new Date('2026-12-01'),
      },
      { isPaying: true, now }
    );
    expect(testUser.payingCustomer).toBe(false);
    expect(testUser.subscriptionActive).toBe(false);
    expect(testUser.emailVerified).toBe(true);

    const active = computeBusinessStatusFlags(
      {
        isTest: false,
        subscriptionStatus: 'active',
        subscriptionCurrentPeriodEnd: new Date('2026-12-01'),
      },
      { now }
    );
    expect(active.subscriptionActive).toBe(true);

    const expired = computeBusinessStatusFlags(
      {
        isTest: false,
        subscriptionStatus: 'active',
        subscriptionCurrentPeriodEnd: new Date('2025-01-01'),
      },
      { now }
    );
    expect(expired.subscriptionActive).toBe(false);
  });

  it('clamps out-of-range pages to the last valid page', () => {
    expect(resolveEffectivePage(99, 195, 25)).toBe(8);
    expect(resolveEffectivePage(0, 195, 25)).toBe(1);
    expect(resolveEffectivePage(-3, 195, 25)).toBe(1);
    expect(resolveEffectivePage('abc', 195, 25)).toBe(1);
    expect(resolveEffectivePage('', 195, 25)).toBe(1);
    expect(resolveEffectivePage(5, 0, 25)).toBe(1);
  });

  it('exposes First/Previous/Next/Last control state correctly', () => {
    expect(navControlState(1, 8)).toEqual({
      firstDisabled: true,
      previousDisabled: true,
      nextDisabled: false,
      lastDisabled: false,
    });
    expect(navControlState(8, 8)).toEqual({
      firstDisabled: false,
      previousDisabled: false,
      nextDisabled: true,
      lastDisabled: true,
    });
    expect(navControlState(1, 0)).toEqual({
      firstDisabled: true,
      previousDisabled: true,
      nextDisabled: true,
      lastDisabled: true,
    });
  });

  it('builds a direct page window covering small page counts', () => {
    expect(buildPageWindow(3, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const large = buildPageWindow(10, 40);
    expect(large[0]).toBe(1);
    expect(large[large.length - 1]).toBe(40);
    expect(large).toContain(10);
    expect(large).toContain(null);
  });

  it('pagination meta includes effective page, limit, and sort', () => {
    const meta = buildPaginationMeta({ page: 99, limit: 25, total: 195, sort: 'email_asc' });
    expect(meta).toMatchObject({
      page: 8,
      limit: 25,
      total: 195,
      totalPages: 8,
      sort: 'email_asc',
      hasPrevious: true,
      hasNext: false,
      hasFirst: true,
      hasLast: false,
    });
  });

  it('URL state round-trips query, page, limit, and sort including status sorts', () => {
    const qs = serializeListState({
      query: 'alice@example.com',
      page: 3,
      limit: 50,
      sort: 'paying_first',
    });
    expect(qs).toContain('query=alice%40example.com');
    expect(parseListState(qs)).toEqual({
      query: 'alice@example.com',
      page: 3,
      limit: 50,
      sort: 'paying_first',
    });
    expect(parseListState('?page=2&limit=100&sort=verified_first')).toMatchObject({
      query: '',
      page: 2,
      limit: 100,
      sort: 'verified_first',
    });
  });

  it('browser Back/Forward reloads corresponding table state from history', () => {
    const stack = [
      serializeListState({ query: '', page: 1, limit: 25, sort: 'created_desc' }),
      serializeListState({ query: '', page: 2, limit: 50, sort: 'email_asc' }),
      serializeListState({ query: 'tide', page: 1, limit: 50, sort: 'email_asc' }),
    ];
    const back = navigateHistory(stack, 2, 'back');
    expect(back.index).toBe(1);
    expect(back.state).toEqual({ query: '', page: 2, limit: 50, sort: 'email_asc' });
    const forward = navigateHistory(stack, back.index, 'forward');
    expect(forward.index).toBe(2);
    expect(forward.state.query).toBe('tide');
  });

  it('empty datasets render page 1 with disabled navigation', () => {
    const meta = buildPaginationMeta({ page: 5, limit: 25, total: 0, sort: 'created_desc' });
    expect(meta.page).toBe(1);
    expect(meta.totalPages).toBe(0);
    expect(navControlState(meta.page, meta.totalPages).firstDisabled).toBe(true);
    expect(navControlState(meta.page, meta.totalPages).nextDisabled).toBe(true);
  });
});
