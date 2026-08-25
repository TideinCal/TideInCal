import { describe, it, expect } from 'vitest';
import {
  ALLOWED_PAGE_SIZES,
  DEFAULT_SORT,
  MAX_PAGE_SIZE,
  SORT_SPECS,
  buildPageWindow,
  buildPaginationMeta,
  navigateHistory,
  navControlState,
  parseListState,
  resolveEffectivePage,
  resolveLimit,
  resolveSortKey,
  serializeListState,
} from '../customerListParams.js';

describe('customerListParams', () => {
  it('allowlists sorts and falls back to newest-first', () => {
    expect(resolveSortKey('created_asc')).toBe('created_asc');
    expect(resolveSortKey('email_desc')).toBe('email_desc');
    expect(resolveSortKey('status_asc')).toBe(DEFAULT_SORT);
    expect(resolveSortKey(undefined)).toBe(DEFAULT_SORT);
    expect(SORT_SPECS.created_desc).toEqual({ createdAt: -1, _id: -1 });
    expect(SORT_SPECS.name_asc).toEqual({ firstName: 1, lastName: 1, _id: 1 });
  });

  it('accepts page sizes 25/50/100/200 and clamps oversized/invalid input', () => {
    for (const size of ALLOWED_PAGE_SIZES) {
      expect(resolveLimit(size)).toBe(size);
      expect(resolveLimit(String(size))).toBe(size);
    }
    expect(resolveLimit(500)).toBe(MAX_PAGE_SIZE);
    expect(resolveLimit(9999)).toBe(200);
    expect(resolveLimit(0)).toBe(25);
    expect(resolveLimit(-10)).toBe(25);
    expect(resolveLimit('nope')).toBe(25);
    expect(resolveLimit(75)).toBe(75);
    expect(resolveLimit(10)).toBe(10);
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

  it('URL state round-trips query, page, limit, and sort', () => {
    const qs = serializeListState({
      query: 'alice@example.com',
      page: 3,
      limit: 50,
      sort: 'name_desc',
    });
    expect(qs).toContain('query=alice%40example.com');
    expect(parseListState(qs)).toEqual({
      query: 'alice@example.com',
      page: 3,
      limit: 50,
      sort: 'name_desc',
    });
    expect(parseListState('?page=2&limit=100&sort=created_asc')).toMatchObject({
      query: '',
      page: 2,
      limit: 100,
      sort: 'created_asc',
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
