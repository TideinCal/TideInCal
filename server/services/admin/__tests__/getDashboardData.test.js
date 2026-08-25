import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';

describe('getDashboardData excludes test accounts from business totals', () => {
  let users;

  beforeEach(() => {
    const now = new Date();
    const future = new Date(now.getTime() + 86400000);
    const past = new Date(now.getTime() - 86400000);

    users = [
      // Business users (missing isTest = legacy business)
      {
        _id: new ObjectId(),
        subscriptionStatus: 'active',
        subscriptionCurrentPeriodEnd: future,
      },
      {
        _id: new ObjectId(),
        isTest: false,
        subscriptionStatus: 'active',
        subscriptionCurrentPeriodEnd: future,
      },
      {
        _id: new ObjectId(),
        isTest: false,
        subscriptionStatus: 'canceled',
        subscriptionCurrentPeriodEnd: past,
      },
      // Test users — must not appear in business totals
      {
        _id: new ObjectId(),
        isTest: true,
        subscriptionStatus: 'active',
        subscriptionCurrentPeriodEnd: future,
      },
      {
        _id: new ObjectId(),
        isTest: true,
      },
    ];

    vi.resetModules();
    vi.doMock('../../../db/index.js', () => ({
      getDatabase: () => ({
        collection(name) {
          if (name !== 'users') throw new Error(name);
          return {
            countDocuments: async (filter = {}) => {
              return users.filter((u) => matchesFilter(u, filter)).length;
            },
          };
        },
      }),
    }));
  });

  function matchesFilter(doc, filter) {
    for (const [key, cond] of Object.entries(filter)) {
      const val = doc[key];
      if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
        if ('$ne' in cond) {
          if (val === cond.$ne) return false;
          continue;
        }
        if ('$gt' in cond) {
          if (!(val instanceof Date) || !(val > cond.$gt)) return false;
          continue;
        }
      } else if (val !== cond) {
        return false;
      }
    }
    return true;
  }

  it('excludes isTest:true from business totals; includes false and missing', async () => {
    const { getDashboardData, BUSINESS_USER_FILTER } = await import(
      '../getDashboardData.js'
    );

    expect(BUSINESS_USER_FILTER).toEqual({ isTest: { $ne: true } });

    const data = await getDashboardData();
    // 3 business users (missing, false+active, false+canceled)
    expect(data.totalUsers).toBe(3);
    // 2 business active subscribers
    expect(data.activeSubscribers).toBe(2);
    // Test activity reported separately, not mixed into business totals
    expect(data.testActivity.totalUsers).toBe(2);
    expect(data.testActivity.activeSubscribers).toBe(1);
  });
});
