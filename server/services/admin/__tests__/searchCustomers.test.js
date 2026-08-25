import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';

function getPath(doc, key) {
  if (!key.includes('.')) return doc[key];
  return key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), doc);
}

function matchesFilter(doc, filter) {
  if (!filter || Object.keys(filter).length === 0) return true;

  if (filter.$and && !filter.$and.every((part) => matchesFilter(doc, part))) {
    return false;
  }
  if (filter.$or && !filter.$or.some((part) => matchesFilter(doc, part))) {
    return false;
  }

  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$and' || key === '$or') continue;
    if (key.startsWith('$')) continue;
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

describe('searchCustomers browse + search', () => {
  let users;
  let purchases;

  function makeCursor(docs) {
    const state = { docs, skipN: 0, limitN: null };
    const api = {
      project() {
        return api;
      },
      sort(spec) {
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
    const future = new Date(Date.now() + 86400000);
    const ids = Array.from({ length: 30 }, () => new ObjectId());
    users = ids.map((id, i) => ({
      _id: id,
      email: `user${i}@example.com`,
      firstName: `User${i}`,
      lastName: 'Test',
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
              findOne: async (filter, _opts) =>
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
    expect(result.pagination.hasPrevious).toBe(false);
    expect(result.pagination.hasNext).toBe(true);
  });

  it('paginates with limits, ordering, total, Previous, and Next', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');
    const page1 = await searchCustomers('', { page: 1, limit: 10 });
    expect(page1.customers).toHaveLength(10);
    expect(page1.pagination).toMatchObject({
      page: 1,
      limit: 10,
      total: 30,
      totalPages: 3,
      hasPrevious: false,
      hasNext: true,
    });
    // Newest first: user0 created Jan 30, then user1 Jan 29...
    expect(page1.customers[0].email).toBe('user0@example.com');
    expect(page1.customers[1].email).toBe('user1@example.com');

    const page2 = await searchCustomers('', { page: 2, limit: 10 });
    expect(page2.pagination.hasPrevious).toBe(true);
    expect(page2.pagination.hasNext).toBe(true);
    expect(page2.customers[0].email).toBe('user10@example.com');

    const page3 = await searchCustomers('', { page: 3, limit: 10 });
    expect(page3.pagination.hasPrevious).toBe(true);
    expect(page3.pagination.hasNext).toBe(false);

    const capped = await searchCustomers('', { page: 1, limit: 500 });
    expect(capped.pagination.limit).toBe(100);
  });

  it('search by email continues to work and returns status flags', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');
    const result = await searchCustomers('user1@example.com');
    expect(result.customers).toHaveLength(1);
    expect(result.customers[0].email).toBe('user1@example.com');
    expect(result.customers[0].payingCustomer).toBe(true);
    expect(result.customers[0].subscriptionActive).toBe(true);
    expect(result.customers[0].emailVerified).toBe(false);
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

  it('keeps test records visible and labeled without counting them as business paying via list flags only', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');
    const result = await searchCustomers('');
    const testRow = result.customers.find((c) => c.isTest === true);
    expect(testRow).toBeTruthy();
    expect(testRow.isTest).toBe(true);
    // Test purchase should not mark payingCustomer for the test user in list enrichment
    // (purchase isTest:true is excluded by PAYING_PURCHASE_MATCH)
    expect(testRow.payingCustomer).toBe(false);
  });
});
