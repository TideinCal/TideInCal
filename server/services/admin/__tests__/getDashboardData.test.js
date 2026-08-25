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

    if (cond && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
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

    if (val !== cond) return false;
  }
  return true;
}

function runAggregate(purchaseDocs, userDocs, pipeline) {
  let rows = purchaseDocs.map((p) => ({ ...p }));
  for (const stage of pipeline) {
    if (stage.$match) {
      rows = rows.filter((r) => matchesFilter(r, stage.$match));
    } else if (stage.$group) {
      const idExpr = stage.$group._id;
      const field = typeof idExpr === 'string' ? idExpr.replace(/^\$/, '') : null;
      const map = new Map();
      for (const r of rows) {
        const keyVal = field ? r[field] : null;
        if (keyVal == null) continue;
        const key = keyVal.toString();
        if (!map.has(key)) map.set(key, { _id: keyVal });
      }
      rows = Array.from(map.values());
    } else if (stage.$lookup) {
      rows = rows.map((r) => {
        const local = r[stage.$lookup.localField];
        const matched = userDocs.filter(
          (u) => u[stage.$lookup.foreignField].toString() === local.toString()
        );
        return { ...r, [stage.$lookup.as]: matched };
      });
    } else if (stage.$unwind) {
      const field = stage.$unwind.replace(/^\$/, '');
      const next = [];
      for (const r of rows) {
        for (const item of r[field] || []) {
          next.push({ ...r, [field]: item });
        }
      }
      rows = next;
    } else if (stage.$count) {
      return [{ [stage.$count]: rows.length }];
    }
  }
  return rows;
}

describe('getDashboardData business metrics', () => {
  let users;
  let purchases;
  let future;

  beforeEach(() => {
    const now = new Date();
    future = new Date(now.getTime() + 86400000);

    const uLegacy = new ObjectId();
    const uVerifiedPaying = new ObjectId();
    const uVerifiedMulti = new ObjectId();
    const uUnverified = new ObjectId();
    const uActiveSub = new ObjectId();
    const uTest = new ObjectId();
    const uTestPaying = new ObjectId();
    const uRefundedOnly = new ObjectId();
    const uZeroAmount = new ObjectId();

    users = [
      { _id: uLegacy },
      {
        _id: uVerifiedPaying,
        isTest: false,
        emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        _id: uVerifiedMulti,
        isTest: false,
        emailVerifiedAt: new Date('2026-02-01T00:00:00.000Z'),
      },
      { _id: uUnverified, isTest: false, emailVerifiedAt: null },
      {
        _id: uActiveSub,
        isTest: false,
        emailVerifiedAt: new Date('2026-03-01T00:00:00.000Z'),
        subscriptionStatus: 'active',
        subscriptionCurrentPeriodEnd: future,
      },
      {
        _id: uTest,
        isTest: true,
        emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
        subscriptionStatus: 'active',
        subscriptionCurrentPeriodEnd: future,
      },
      {
        _id: uTestPaying,
        isTest: true,
        emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        _id: uRefundedOnly,
        isTest: false,
        emailVerifiedAt: new Date('2026-04-01T00:00:00.000Z'),
      },
      { _id: uZeroAmount, isTest: false, emailVerifiedAt: 'not-a-date' },
    ];

    purchases = [
      { _id: new ObjectId(), userId: uVerifiedPaying, amount: 999, isTest: false },
      { _id: new ObjectId(), userId: uVerifiedMulti, amount: 499, isTest: false },
      { _id: new ObjectId(), userId: uVerifiedMulti, amount: 2999, isTest: false },
      { _id: new ObjectId(), userId: uTestPaying, amount: 999, isTest: true },
      {
        _id: new ObjectId(),
        userId: uRefundedOnly,
        amount: 999,
        isTest: false,
        fullyRefundedAt: new Date(),
      },
      { _id: new ObjectId(), userId: uZeroAmount, amount: 0, isTest: false },
      { _id: new ObjectId(), userId: uZeroAmount, amount: '999', isTest: false },
      { _id: new ObjectId(), amount: 999, isTest: false },
    ];

    vi.resetModules();
    vi.doMock('../../../db/index.js', () => ({
      getDatabase: () => ({
        collection(name) {
          if (name === 'users') {
            return {
              countDocuments: async (filter = {}) =>
                users.filter((u) => matchesFilter(u, filter)).length,
              findOne: async (filter) => users.find((u) => matchesFilter(u, filter)) || null,
            };
          }
          if (name === 'purchases') {
            return {
              aggregate: (pipeline) => ({
                toArray: async () => runAggregate(purchases, users, pipeline),
              }),
            };
          }
          throw new Error(name);
        },
      }),
    }));
  });

  it('excludes isTest:true from every business metric; missing isTest counts as business', async () => {
    const { getDashboardData } = await import('../getDashboardData.js');
    const data = await getDashboardData();

    expect(data.business.registeredAccounts).toBe(7);
    expect(data.testActivity.registeredAccounts).toBe(2);
    expect(data.business.verifiedEmailAccounts).toBe(4);
    expect(data.business.payingCustomers).toBe(2);
    expect(data.business.activeSubscribers).toBe(1);
    expect(data.testActivity.activeSubscribers).toBe(1);
  });

  it('requires a valid non-null emailVerifiedAt date for verified counts', async () => {
    const { getDashboardData } = await import('../getDashboardData.js');
    const data = await getDashboardData();
    // null and string "not-a-date" excluded; only Date values among non-test
    expect(data.business.verifiedEmailAccounts).toBe(4);
  });

  it('counts a multi-purchase customer once; rejects zero/refunded/malformed/missing-user/test purchases', async () => {
    const { countPayingCustomers } = await import('../getDashboardData.js');
    const { getDatabase } = await import('../../../db/index.js');
    expect(await countPayingCustomers(getDatabase())).toBe(2);
  });

  it('active subscriber logic requires active status and future period end', async () => {
    users.push({
      _id: new ObjectId(),
      isTest: false,
      subscriptionStatus: 'active',
      subscriptionCurrentPeriodEnd: new Date(Date.now() - 1000),
    });
    users.push({
      _id: new ObjectId(),
      isTest: false,
      subscriptionStatus: 'canceled',
      subscriptionCurrentPeriodEnd: future,
    });
    const { getDashboardData } = await import('../getDashboardData.js');
    const data = await getDashboardData();
    expect(data.business.activeSubscribers).toBe(1);
  });
});
