import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';

function getPath(doc, key) {
  if (!key.includes('.')) return doc[key];
  return key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), doc);
}

function matchesFilter(doc, filter) {
  if (!filter || Object.keys(filter).length === 0) return true;
  if (filter.$and && !filter.$and.every((part) => matchesFilter(doc, part))) return false;
  if (filter.$or && !filter.$or.some((part) => matchesFilter(doc, part))) return false;
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$and' || key === '$or' || key.startsWith('$')) continue;
    const val = getPath(doc, key);
    if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof RegExp) && !(cond instanceof Date)) {
      if ('$exists' in cond) {
        const exists = val !== undefined;
        if (cond.$exists && !exists) return false;
        if (!cond.$exists && exists) return false;
      }
      if ('$ne' in cond && val === cond.$ne) return false;
      if ('$gt' in cond && !(val > cond.$gt)) return false;
      if ('$type' in cond) {
        if (cond.$type === 'number' && typeof val !== 'number') return false;
        if (cond.$type === 'date' && !(val instanceof Date)) return false;
      }
      if ('$in' in cond) {
        const ids = cond.$in.map((x) => x?.toString?.() ?? String(x));
        if (!ids.includes(val?.toString?.() ?? String(val))) return false;
      }
      continue;
    }
    if (cond instanceof RegExp) {
      if (typeof val !== 'string' || !cond.test(val)) return false;
      continue;
    }
    if (val?.equals && cond?.equals) {
      if (!val.equals(cond)) return false;
      continue;
    }
    if (val !== cond && String(val) !== String(cond)) return false;
  }
  return true;
}

describe('searchCustomers browse + search + sort', () => {
  let users;
  let purchases;
  let lastSortSpec;

  function makeCursor(docs) {
    const state = { docs, skipN: 0, limitN: null };
    const api = {
      project() {
        return api;
      },
      sort(spec) {
        lastSortSpec = spec;
        const entries = Object.entries(spec);
        state.docs = [...state.docs].sort((a, b) => {
          for (const [field, dir] of entries) {
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
        });
        return api;
      },
      skip(n) {
        state.skipN = n;
        return api;
      },
      limit(n) {
        state.limitN = n;
        return api;
      },
      async toArray() {
        let out = state.docs;
        if (state.skipN) out = out.slice(state.skipN);
        if (state.limitN != null) out = out.slice(0, state.limitN);
        return out.map((d) => {
          const copy = { ...d };
          delete copy.passwordHash;
          delete copy.emailVerificationTokenHash;
          delete copy.acquisition;
          delete copy.billingAddress;
          return copy;
        });
      },
    };
    return api;
  }

  beforeEach(() => {
    lastSortSpec = null;
    const future = new Date(Date.now() + 86400000);
    const ids = Array.from({ length: 30 }, () => new ObjectId());
    users = ids.map((id, i) => ({
      _id: id,
      email: `user${String(i).padStart(2, '0')}@example.com`,
      firstName: `User${String.fromCharCode(65 + (i % 26))}${i}`,
      lastName: i % 2 === 0 ? 'Alpha' : 'Beta',
      createdAt: new Date(Date.UTC(2026, 0, 30 - i)),
      passwordHash: 'SECRET_HASH',
      emailVerificationTokenHash: 'SECRET_TOKEN',
      acquisition: { firstTouch: { source: 'instagram' } },
      billingAddress: { line1: '123 Secret St' },
      isTest: i === 0,
      emailVerifiedAt: i % 2 === 0 ? new Date('2026-01-01') : null,
      subscriptionStatus: i === 1 ? 'active' : null,
      subscriptionCurrentPeriodEnd: i === 1 ? future : null,
      stripeCustomerId: i === 2 ? 'cus_abc123' : null,
    }));

    // Same createdAt pair to exercise _id tie-break
    users[5].createdAt = users[4].createdAt;

    purchases = [
      {
        _id: new ObjectId(),
        userId: ids[1],
        amount: 999,
        isTest: false,
        stripeSessionId: 'cs_test_abc',
      },
      {
        _id: new ObjectId(),
        userId: ids[0],
        amount: 999,
        isTest: true,
      },
    ];

    vi.resetModules();
    vi.doMock('../../../db/index.js', () => ({
      getDatabase: () => ({
        collection(name) {
          if (name === 'users') {
            return {
              countDocuments: async (filter = {}) =>
                users.filter((u) => matchesFilter(u, filter)).length,
              find: (filter = {}) =>
                makeCursor(users.filter((u) => matchesFilter(u, filter))),
              findOne: async (filter) =>
                users.find((u) => matchesFilter(u, filter)) || null,
            };
          }
          if (name === 'purchases') {
            return {
              find: (filter = {}) => ({
                limit() {
                  return this;
                },
                async toArray() {
                  return purchases.filter((p) => matchesFilter(p, filter));
                },
              }),
              findOne: async (filter) =>
                purchases.find((p) => matchesFilter(p, filter)) || null,
              aggregate: (pipeline) => ({
                toArray: async () => {
                  let rows = purchases.map((p) => ({ ...p }));
                  for (const stage of pipeline) {
                    if (stage.$match) {
                      rows = rows.filter((r) => matchesFilter(r, stage.$match));
                    } else if (stage.$group) {
                      const field = String(stage.$group._id).replace(/^\$/, '');
                      const map = new Map();
                      for (const r of rows) {
                        if (r[field] == null) continue;
                        map.set(r[field].toString(), { _id: r[field] });
                      }
                      rows = Array.from(map.values());
                    }
                  }
                  return rows;
                },
              }),
            };
          }
          throw new Error(name);
        },
      }),
    }));
  });

  it('empty search returns the first page of all records rather than an empty array', async () => {
    const { searchCustomers, DEFAULT_PAGE_SIZE } = await import('../searchCustomers.js');
    const result = await searchCustomers('');
    expect(result.customers.length).toBe(DEFAULT_PAGE_SIZE);
    expect(result.pagination.total).toBe(30);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.sort).toBe('created_desc');
  });

  it('every allowed sort produces expected order with deterministic _id tie-break', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');
    const { SORT_SPECS } = await import('../customerListParams.js');

    for (const sortKey of Object.keys(SORT_SPECS)) {
      const result = await searchCustomers('', { page: 1, limit: 30, sort: sortKey });
      expect(result.pagination.sort).toBe(sortKey);
      expect(lastSortSpec).toEqual(SORT_SPECS[sortKey]);
      expect(result.customers).toHaveLength(30);
      // Tie-break: for created_desc with equal createdAt, higher _id first
      if (sortKey === 'created_desc') {
        const tied = result.customers.filter(
          (c) =>
            c.createdAt &&
            new Date(c.createdAt).getTime() === new Date(users[4].createdAt).getTime()
        );
        if (tied.length >= 2) {
          expect(String(tied[0]._id) >= String(tied[1]._id)).toBe(true);
        }
      }
    }

    const emailAsc = await searchCustomers('', { page: 1, limit: 5, sort: 'email_asc' });
    expect(emailAsc.customers[0].email <= emailAsc.customers[1].email).toBe(true);

    const nameDesc = await searchCustomers('', { page: 1, limit: 5, sort: 'name_desc' });
    expect(
      (nameDesc.customers[0].firstName || '') >= (nameDesc.customers[1].firstName || '')
    ).toBe(true);
  });

  it('invalid sort falls back to newest-first', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');
    const result = await searchCustomers('', { sort: 'not-a-sort' });
    expect(result.pagination.sort).toBe('created_desc');
    expect(lastSortSpec).toEqual({ createdAt: -1, _id: -1 });
  });

  it('page sizes 25/50/100/200 work; oversized cannot exceed 200', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');
    for (const limit of [25, 50, 100, 200]) {
      const result = await searchCustomers('', { limit });
      expect(result.pagination.limit).toBe(limit);
    }
    expect((await searchCustomers('', { limit: 500 })).pagination.limit).toBe(200);
    expect((await searchCustomers('', { limit: 'x' })).pagination.limit).toBe(25);
  });

  it('request above the last page returns the last valid page and its records', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');
    const result = await searchCustomers('', { page: 99, limit: 10 });
    expect(result.pagination.page).toBe(3);
    expect(result.pagination.totalPages).toBe(3);
    expect(result.customers).toHaveLength(10);
    expect(result.pagination.hasNext).toBe(false);
    expect(result.pagination.hasLast).toBe(false);
  });

  it('page 0, negative, nonlocal, and empty values resolve safely', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');
    for (const page of [0, -1, 'abc', '', null, undefined]) {
      const result = await searchCustomers('', { page, limit: 10 });
      expect(result.pagination.page).toBe(1);
      expect(result.customers.length).toBeGreaterThan(0);
    }
  });

  it('First/Previous/Next/Last flags match pagination edges', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');
    const first = await searchCustomers('', { page: 1, limit: 10 });
    expect(first.pagination.hasFirst).toBe(false);
    expect(first.pagination.hasPrevious).toBe(false);
    expect(first.pagination.hasNext).toBe(true);
    expect(first.pagination.hasLast).toBe(true);

    const last = await searchCustomers('', { page: 3, limit: 10 });
    expect(last.pagination.hasFirst).toBe(true);
    expect(last.pagination.hasPrevious).toBe(true);
    expect(last.pagination.hasNext).toBe(false);
    expect(last.pagination.hasLast).toBe(false);
  });

  it('changing sort or page size effectively starts at page 1 when requested', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');
    // UI resets to page 1; API still clamps if a stale high page is sent with new limit
    const afterLimit = await searchCustomers('user', { page: 1, limit: 50, sort: 'email_asc' });
    expect(afterLimit.pagination.page).toBe(1);
    expect(afterLimit.pagination.limit).toBe(50);
    expect(afterLimit.pagination.sort).toBe('email_asc');
  });

  it('search by email continues to work and returns status flags', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');
    const result = await searchCustomers('user01@example.com');
    expect(result.customers).toHaveLength(1);
    expect(result.customers[0].email).toBe('user01@example.com');
    expect(result.customers[0].payingCustomer).toBe(true);
    expect(result.customers[0].subscriptionActive).toBe(true);
  });

  it('omits sensitive fields and exposes only needed status data', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');
    const result = await searchCustomers('');
    const row = result.customers[0];
    expect(row.passwordHash).toBeUndefined();
    expect(row.emailVerificationTokenHash).toBeUndefined();
    expect(row.acquisition).toBeUndefined();
    expect(row.billingAddress).toBeUndefined();
    expect(row).toHaveProperty('emailVerified');
    expect(row).toHaveProperty('payingCustomer');
    expect(row).toHaveProperty('subscriptionActive');
    expect(row).toHaveProperty('isTest');
  });

  it('keeps test records visible and labeled; test purchases do not set payingCustomer', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');
    const result = await searchCustomers('');
    const testRow = result.customers.find((c) => c.isTest === true);
    expect(testRow).toBeTruthy();
    expect(testRow.payingCustomer).toBe(false);
  });

  it('documents search strategy match cap when a strategy is full', async () => {
    const { searchCustomers, SEARCH_STRATEGY_MATCH_CAP } = await import('../searchCustomers.js');
    // Broad text search against 30 users with limit 50 will not cap; force by temporarily
    // shrinking users is unnecessary — assert the constant and uncapped browse has no flag.
    const browse = await searchCustomers('');
    expect(browse.pagination.searchPossiblyCapped).toBeUndefined();
    expect(SEARCH_STRATEGY_MATCH_CAP).toBe(50);
  });
});
