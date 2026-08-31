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

function resolveFieldRef(doc, ref) {
  if (typeof ref === 'string' && ref.startsWith('$')) {
    return getPath(doc, ref.slice(1));
  }
  return ref;
}

function evalExpr(doc, expr) {
  if (expr == null || typeof expr !== 'object' || Array.isArray(expr) || expr instanceof Date) {
    return resolveFieldRef(doc, expr);
  }
  if ('$eq' in expr) {
    const [a, b] = expr.$eq;
    return evalExpr(doc, a) === evalExpr(doc, b);
  }
  if ('$ne' in expr) {
    const [a, b] = expr.$ne;
    return evalExpr(doc, a) !== evalExpr(doc, b);
  }
  if ('$gt' in expr) {
    const [a, b] = expr.$gt;
    return evalExpr(doc, a) > evalExpr(doc, b);
  }
  if ('$and' in expr) {
    return expr.$and.every((part) => evalExpr(doc, part));
  }
  if ('$or' in expr) {
    return expr.$or.some((part) => evalExpr(doc, part));
  }
  if ('$cond' in expr) {
    const [cond, whenTrue, whenFalse] = expr.$cond;
    return evalExpr(doc, cond) ? evalExpr(doc, whenTrue) : evalExpr(doc, whenFalse);
  }
  if ('$type' in expr) {
    const val = evalExpr(doc, expr.$type);
    if (val instanceof Date && !Number.isNaN(val.getTime())) return 'date';
    if (typeof val === 'number') return 'number';
    if (val == null) return 'null';
    return typeof val;
  }
  if ('$size' in expr) {
    const val = evalExpr(doc, expr.$size);
    return Array.isArray(val) ? val.length : 0;
  }
  return expr;
}

function applyAddFields(doc, fields) {
  const out = { ...doc };
  for (const [key, expr] of Object.entries(fields)) {
    out[key] = evalExpr(out, expr);
  }
  return out;
}

function sortDocs(docs, spec) {
  const entries = Object.entries(spec);
  return [...docs].sort((a, b) => {
    for (const [field, dir] of entries) {
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
  });
}

describe('searchCustomers browse + search + sort', () => {
  let users;
  let purchases;
  let lastSortSpec;
  let usedAggregate;

  function makeCursor(docs) {
    const state = { docs, skipN: 0, limitN: null };
    const api = {
      project() {
        return api;
      },
      sort(spec) {
        lastSortSpec = spec;
        state.docs = sortDocs(state.docs, spec);
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

  function runUsersAggregate(pipeline) {
    usedAggregate = true;
    let rows = users.map((u) => ({ ...u }));
    for (const stage of pipeline) {
      if (stage.$lookup) {
        const from = stage.$lookup.from;
        const as = stage.$lookup.as;
        const subPipeline = stage.$lookup.pipeline || [];
        rows = rows.map((u) => {
          let joined =
            from === 'purchases'
              ? purchases.filter((p) => String(p.userId) === String(u._id)).map((p) => ({ ...p }))
              : [];
          for (const sub of subPipeline) {
            if (sub.$match) {
              joined = joined.filter((doc) => {
                const withVars = { ...doc };
                // $expr $eq ['$userId', '$$uid'] already satisfied by outer filter
                const match = { ...sub.$match };
                if (match.$and) {
                  return match.$and.every((part) => {
                    if (part.$expr) return true;
                    return matchesFilter(withVars, part);
                  });
                }
                return matchesFilter(withVars, match);
              });
            } else if (sub.$limit) {
              joined = joined.slice(0, sub.$limit);
            } else if (sub.$project) {
              joined = joined.map((doc) => {
                const out = {};
                for (const [k, v] of Object.entries(sub.$project)) {
                  if (v === 1 || v === true) out[k] = doc[k];
                }
                if (!Object.keys(out).length) return { _id: doc._id };
                return out;
              });
            }
          }
          return { ...u, [as]: joined };
        });
      } else if (stage.$addFields) {
        rows = rows.map((doc) => applyAddFields(doc, stage.$addFields));
      } else if (stage.$sort) {
        rows = sortDocs(rows, stage.$sort);
      } else if (stage.$skip) {
        rows = rows.slice(stage.$skip);
      } else if (stage.$limit) {
        rows = rows.slice(0, stage.$limit);
      } else if (stage.$count) {
        return [{ [stage.$count]: rows.length }];
      } else if (stage.$project) {
        rows = rows.map((doc) => {
          const out = { ...doc };
          for (const [k, v] of Object.entries(stage.$project)) {
            if (v === 0 || v === false) delete out[k];
          }
          return out;
        });
      }
    }
    return rows;
  }

  beforeEach(() => {
    lastSortSpec = null;
    usedAggregate = false;
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
      // Oldest accounts with qualifying purchases — buried on page 2 under created_desc
      {
        _id: new ObjectId(),
        userId: ids[28],
        amount: 500,
        isTest: false,
      },
      {
        _id: new ObjectId(),
        userId: ids[29],
        amount: 500,
        isTest: false,
      },
      // Inconsistent legacy purchase on test user (purchase not marked test)
      {
        _id: new ObjectId(),
        userId: ids[0],
        amount: 999,
        isTest: false,
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
              aggregate: (pipeline) => ({
                toArray: async () => runUsersAggregate(pipeline),
              }),
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

  it('every field sort produces expected order with deterministic _id tie-break', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');
    const { FIELD_SORT_SPECS } = await import('../customerListParams.js');

    for (const sortKey of Object.keys(FIELD_SORT_SPECS)) {
      const result = await searchCustomers('', { page: 1, limit: 25, sort: sortKey });
      expect(result.pagination.sort).toBe(sortKey);
      expect(lastSortSpec).toEqual(FIELD_SORT_SPECS[sortKey]);
      expect(result.customers).toHaveLength(25);
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

    const emailAsc = await searchCustomers('', { page: 1, limit: 25, sort: 'email_asc' });
    expect(emailAsc.customers[0].email <= emailAsc.customers[1].email).toBe(true);

    const nameDesc = await searchCustomers('', { page: 1, limit: 25, sort: 'name_desc' });
    expect(
      (nameDesc.customers[0].firstName || '') >= (nameDesc.customers[1].firstName || '')
    ).toBe(true);
  });

  it('verified-first and unverified-first use valid-date definition matching badges', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');
    // Non-date value must not count as verified (badge + sort)
    users[3].emailVerifiedAt = 'not-a-date';

    const verifiedFirst = await searchCustomers('', { sort: 'verified_first', limit: 25 });
    expect(usedAggregate).toBe(true);
    expect(verifiedFirst.pagination.sort).toBe('verified_first');
    const firstUnverified = verifiedFirst.customers.find((c) => !c.emailVerified);
    expect(verifiedFirst.customers.some((c) => c.emailVerified)).toBe(true);
    if (firstUnverified) {
      const firstUnverifiedIdx = verifiedFirst.customers.indexOf(firstUnverified);
      expect(verifiedFirst.customers.slice(0, firstUnverifiedIdx).every((c) => c.emailVerified)).toBe(
        true
      );
    }
    const invalidRow = verifiedFirst.customers.find((c) => String(c._id) === String(users[3]._id));
    expect(invalidRow.emailVerified).toBe(false);

    const unverifiedFirst = await searchCustomers('', { sort: 'unverified_first', limit: 25 });
    expect(unverifiedFirst.customers[0].emailVerified).toBe(false);
  });

  it('paying-first sorts before pagination using qualifying purchases', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');

    const byCreated = await searchCustomers('', { sort: 'created_desc', limit: 25 });
    const buriedPaying = byCreated.customers.filter((c) =>
      [String(users[28]._id), String(users[29]._id)].includes(String(c._id))
    );
    expect(buriedPaying).toHaveLength(0);

    const payingFirst = await searchCustomers('', { sort: 'paying_first', limit: 25 });
    expect(payingFirst.pagination.sort).toBe('paying_first');
    const page1Ids = payingFirst.customers.map((c) => String(c._id));
    expect(page1Ids).toContain(String(users[28]._id));
    expect(page1Ids).toContain(String(users[29]._id));
    expect(page1Ids).toContain(String(users[1]._id));
    // Paying block first
    const firstNonPayingIdx = payingFirst.customers.findIndex((c) => !c.payingCustomer);
    expect(payingFirst.customers.slice(0, firstNonPayingIdx).every((c) => c.payingCustomer)).toBe(
      true
    );

    const nonpayingFirst = await searchCustomers('', { sort: 'nonpaying_first', limit: 25 });
    expect(nonpayingFirst.customers[0].payingCustomer).toBe(false);
  });

  it('test users are not business-paying even with inconsistent legacy purchases', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');
    const payingFirst = await searchCustomers('', { sort: 'paying_first', limit: 25 });
    const testRow = payingFirst.customers.find((c) => String(c._id) === String(users[0]._id));
    expect(testRow.isTest).toBe(true);
    expect(testRow.payingCustomer).toBe(false);
    // Test user must not lead the paying-first list
    expect(String(payingFirst.customers[0]._id)).not.toBe(String(users[0]._id));
  });

  it('active-first and inactive-first use active status plus future period end', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');
    const now = new Date();
    users[2].subscriptionStatus = 'active';
    users[2].subscriptionCurrentPeriodEnd = new Date(now.getTime() - 86400000); // expired
    users[3].subscriptionStatus = 'canceled';
    users[3].subscriptionCurrentPeriodEnd = new Date(now.getTime() + 86400000);

    const activeFirst = await searchCustomers('', { sort: 'active_first', limit: 25, now });
    expect(activeFirst.customers[0].subscriptionActive).toBe(true);
    expect(String(activeFirst.customers[0]._id)).toBe(String(users[1]._id));
    const expired = activeFirst.customers.find((c) => String(c._id) === String(users[2]._id));
    expect(expired.subscriptionActive).toBe(false);

    const inactiveFirst = await searchCustomers('', { sort: 'inactive_first', limit: 25, now });
    expect(inactiveFirst.customers[0].subscriptionActive).toBe(false);
  });

  it('status-group ties use newest-created then _id descending', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');
    // users[28] and [29] are both paying; 28 is newer (createdAt day 2 vs day 1)
    const payingFirst = await searchCustomers('', { sort: 'paying_first', limit: 25 });
    const paying = payingFirst.customers.filter((c) => c.payingCustomer);
    const idx28 = paying.findIndex((c) => String(c._id) === String(users[28]._id));
    const idx29 = paying.findIndex((c) => String(c._id) === String(users[29]._id));
    expect(idx28).toBeGreaterThanOrEqual(0);
    expect(idx29).toBeGreaterThanOrEqual(0);
    expect(idx28).toBeLessThan(idx29);

    // Equal createdAt within verified group → higher _id first
    users[6].emailVerifiedAt = new Date('2026-01-01');
    users[7].emailVerifiedAt = new Date('2026-01-01');
    users[6].createdAt = new Date('2026-02-01');
    users[7].createdAt = new Date('2026-02-01');
    const verified = await searchCustomers('', { sort: 'verified_first', limit: 25 });
    const tied = verified.customers.filter(
      (c) =>
        [String(users[6]._id), String(users[7]._id)].includes(String(c._id)) && c.emailVerified
    );
    if (tied.length === 2) {
      expect(String(tied[0]._id) >= String(tied[1]._id)).toBe(true);
    }
  });

  it('status sorts work on capped search result sets', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');
    const result = await searchCustomers('user', { sort: 'paying_first', limit: 25 });
    expect(result.pagination.sort).toBe('paying_first');
    expect(result.customers.length).toBeGreaterThan(0);
    const firstNonPaying = result.customers.findIndex((c) => !c.payingCustomer);
    if (firstNonPaying > 0) {
      expect(result.customers.slice(0, firstNonPaying).every((c) => c.payingCustomer)).toBe(true);
    }
  });

  it('invalid sort falls back to newest-first', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');
    const result = await searchCustomers('', { sort: 'not-a-sort' });
    expect(result.pagination.sort).toBe('created_desc');
    expect(lastSortSpec).toEqual({ createdAt: -1, _id: -1 });
  });

  it('exactly 25/50/100/200 are accepted; unlisted sizes become 25', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');
    for (const limit of [25, 50, 100, 200]) {
      const result = await searchCustomers('', { limit });
      expect(result.pagination.limit).toBe(limit);
    }
    for (const bad of [1, 10, 75, 199, 201, 500, 25.5, 'x']) {
      expect((await searchCustomers('', { limit: bad })).pagination.limit).toBe(25);
    }
  });

  it('request above the last page returns the last valid page and its records', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');
    const result = await searchCustomers('', { page: 99, limit: 25 });
    expect(result.pagination.page).toBe(2);
    expect(result.pagination.totalPages).toBe(2);
    expect(result.customers).toHaveLength(5);
    expect(result.pagination.hasNext).toBe(false);
    expect(result.pagination.hasLast).toBe(false);
  });

  it('page 0, negative, nonlocal, and empty values resolve safely', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');
    for (const page of [0, -1, 'abc', '', null, undefined]) {
      const result = await searchCustomers('', { page, limit: 25 });
      expect(result.pagination.page).toBe(1);
      expect(result.customers.length).toBeGreaterThan(0);
    }
  });

  it('First/Previous/Next/Last flags match pagination edges', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');
    const first = await searchCustomers('', { page: 1, limit: 25 });
    expect(first.pagination.hasFirst).toBe(false);
    expect(first.pagination.hasPrevious).toBe(false);
    expect(first.pagination.hasNext).toBe(true);
    expect(first.pagination.hasLast).toBe(true);

    const last = await searchCustomers('', { page: 2, limit: 25 });
    expect(last.pagination.hasFirst).toBe(true);
    expect(last.pagination.hasPrevious).toBe(true);
    expect(last.pagination.hasNext).toBe(false);
    expect(last.pagination.hasLast).toBe(false);
  });

  it('changing sort or page size effectively starts at page 1 when requested', async () => {
    const { searchCustomers } = await import('../searchCustomers.js');
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
    const browse = await searchCustomers('');
    expect(browse.pagination.searchPossiblyCapped).toBeUndefined();
    expect(SEARCH_STRATEGY_MATCH_CAP).toBe(50);
  });
});
