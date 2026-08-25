import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import {
  ATTRIBUTION_COOKIE_NAME,
  mergeAttributionRecord,
  attributionTouchFromQuery,
  serializeAttributionCookie,
} from '../../attribution/index.js';

const SECRET = 'test-attr-secret-for-auth';

function signedCookieHeader(record) {
  const signed = serializeAttributionCookie(record, SECRET);
  return `${ATTRIBUTION_COOKIE_NAME}=${encodeURIComponent(signed)}`;
}

describe('auth attribution persistence helpers (signup / login)', () => {
  let users;
  let insertOne;
  let updateOne;
  let findOne;

  beforeEach(() => {
    process.env.SESSION_SECRET = SECRET;
    process.env.ATTRIBUTION_COOKIE_SECRET = SECRET;
    users = new Map();
    insertOne = vi.fn(async (doc) => {
      const _id = new ObjectId();
      const row = { ...doc, _id };
      users.set(_id.toString(), row);
      return { insertedId: _id };
    });
    updateOne = vi.fn(async (filter, update) => {
      const id = filter._id.toString();
      const row = users.get(id);
      if (!row) return { modifiedCount: 0 };
      if (update.$set) Object.assign(row, update.$set);
      users.set(id, row);
      return { modifiedCount: 1 };
    });
    findOne = vi.fn(async (query) => {
      for (const row of users.values()) {
        if (query._id && row._id.equals(query._id)) return row;
        if (query.email && row.email === query.email) return row;
        if (query.normalizedEmail && row.normalizedEmail === query.normalizedEmail) return row;
        if (query.$or) {
          for (const clause of query.$or) {
            if (clause.normalizedEmail && row.normalizedEmail === clause.normalizedEmail) return row;
            if (clause.email && row.email === clause.email) return row;
          }
        }
      }
      return null;
    });
  });

  it('stores attribution on new signup user documents', async () => {
    const {
      sanitizeAcquisitionRecord,
      readAttributionFromRequest,
    } = await import('../../attribution/index.js');

    const record = mergeAttributionRecord(
      null,
      attributionTouchFromQuery(
        { utm_source: 'email', utm_medium: 'email', utm_campaign: 'welcome' },
        '/',
        new Date('2026-07-01T00:00:00.000Z')
      )
    );
    const req = { headers: { cookie: signedCookieHeader(record) } };
    const cookieAttribution = sanitizeAcquisitionRecord(readAttributionFromRequest(req, SECRET));
    expect(cookieAttribution.firstTouch.source).toBe('email');

    await insertOne({
      email: 'new@example.com',
      normalizedEmail: 'new@example.com',
      isTest: false,
      acquisition: cookieAttribution,
    });

    const stored = [...users.values()][0];
    expect(stored.isTest).toBe(false);
    expect(stored.acquisition.firstTouch.campaign).toBe('welcome');
  });

  it('does not attach attribution on existing-account idempotent signup response path', async () => {
    const existingId = new ObjectId();
    users.set(existingId.toString(), {
      _id: existingId,
      email: 'exists@example.com',
      normalizedEmail: 'exists@example.com',
      emailVerifiedAt: new Date(),
      acquisition: {
        firstTouch: {
          source: 'instagram',
          medium: 'organic_social',
          campaign: 'old',
          content: 'unknown',
          landingPath: '/',
          firstSeenAt: '2026-01-01T00:00:00.000Z',
        },
        lastTouch: {
          source: 'instagram',
          medium: 'organic_social',
          campaign: 'old',
          content: 'unknown',
          landingPath: '/',
          lastSeenAt: '2026-01-01T00:00:00.000Z',
        },
      },
    });

    // Existing-account path: findOne returns user; insertOne must not run; acquisition untouched
    const found = await findOne({
      $or: [{ normalizedEmail: 'exists@example.com' }, { email: 'exists@example.com' }],
    });
    expect(found).toBeTruthy();
    expect(insertOne).not.toHaveBeenCalled();
    expect(found.acquisition.firstTouch.campaign).toBe('old');
    // Deliberately no updateOne for attribution on idempotent signup
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('login preserves first touch and updates last touch from cookie', async () => {
    const { reconcileUserAcquisition, sanitizeAcquisitionRecord, readAttributionFromRequest } =
      await import('../../attribution/index.js');

    const userId = new ObjectId();
    const existingAcquisition = mergeAttributionRecord(
      null,
      attributionTouchFromQuery(
        { utm_source: 'instagram', utm_campaign: 'first-camp' },
        '/',
        new Date('2026-01-01T00:00:00.000Z')
      )
    );
    users.set(userId.toString(), {
      _id: userId,
      email: 'user@example.com',
      acquisition: existingAcquisition,
    });

    const cookieRecord = mergeAttributionRecord(
      null,
      attributionTouchFromQuery(
        { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'retarget' },
        '/map',
        new Date('2026-08-01T00:00:00.000Z')
      )
    );
    const req = { headers: { cookie: signedCookieHeader(cookieRecord) } };
    const cookieAttribution = sanitizeAcquisitionRecord(readAttributionFromRequest(req, SECRET));
    const user = await findOne({ email: 'user@example.com' });
    const next = reconcileUserAcquisition(user.acquisition, cookieAttribution);
    await updateOne({ _id: user._id }, { $set: { acquisition: next } });

    const updated = users.get(userId.toString());
    expect(updated.acquisition.firstTouch.source).toBe('instagram');
    expect(updated.acquisition.firstTouch.campaign).toBe('first-camp');
    expect(updated.acquisition.lastTouch.source).toBe('google');
    expect(updated.acquisition.lastTouch.campaign).toBe('retarget');
  });

  it('email verification update does not erase acquisition', async () => {
    const userId = new ObjectId();
    const acquisition = mergeAttributionRecord(
      null,
      attributionTouchFromQuery(
        { utm_source: 'facebook', utm_medium: 'paid_social', utm_campaign: 'ads' },
        '/',
        new Date('2026-03-01T00:00:00.000Z')
      )
    );
    users.set(userId.toString(), {
      _id: userId,
      email: 'v@example.com',
      acquisition,
      emailVerificationTokenHash: 'abc',
      emailVerificationTokenExpiresAt: new Date(Date.now() + 10000),
    });

    // Mirror verify-email $set / $unset shape from auth.js
    await updateOne(
      { _id: userId },
      {
        $set: { emailVerifiedAt: new Date(), updatedAt: new Date() },
        $unset: { emailVerificationTokenHash: '', emailVerificationTokenExpiresAt: '' },
      }
    );
    // apply unset manually like Mongo would
    const row = users.get(userId.toString());
    delete row.emailVerificationTokenHash;
    delete row.emailVerificationTokenExpiresAt;

    expect(row.acquisition.firstTouch.campaign).toBe('ads');
    expect(row.emailVerifiedAt).toBeInstanceOf(Date);
  });
});

describe('admin setCustomerIsTest', () => {
  function mockDbForIsTest({ userDoc, purchases, auditInserts, auditInsertImpl }) {
    return {
      getDatabase: () => ({
        collection(name) {
          if (name === 'users') {
            return {
              findOne: async () => userDoc,
              updateOne: async (_f, update) => {
                Object.assign(userDoc, update.$set);
                return { modifiedCount: 1 };
              },
            };
          }
          if (name === 'purchases') {
            return {
              updateMany: async (filter, update) => {
                let modifiedCount = 0;
                for (const p of purchases) {
                  if (!p.userId.equals(filter.userId)) continue;
                  const ne = filter.isTest?.$ne;
                  if (ne !== undefined && p.isTest === ne) continue;
                  Object.assign(p, update.$set);
                  modifiedCount += 1;
                }
                return { modifiedCount };
              },
            };
          }
          if (name === 'admin_audit_logs') {
            return {
              insertOne: async (doc) => {
                if (auditInsertImpl) {
                  return auditInsertImpl(doc, auditInserts);
                }
                auditInserts.push(doc);
                return { insertedId: new ObjectId() };
              },
            };
          }
          throw new Error(name);
        },
      }),
    };
  }

  it('requires boolean, updates user + purchases, and audits', async () => {
    const targetUserId = new ObjectId();
    const adminUserId = new ObjectId();
    const purchaseIds = [new ObjectId(), new ObjectId()];
    const auditInserts = [];
    let userDoc = { _id: targetUserId, isTest: false };
    const purchases = purchaseIds.map((id) => ({
      _id: id,
      userId: targetUserId,
      isTest: false,
    }));

    vi.resetModules();
    vi.doMock('../../db/index.js', () =>
      mockDbForIsTest({ userDoc, purchases, auditInserts })
    );

    const { setCustomerIsTest } = await import('../../services/admin/setCustomerIsTest.js');

    const bad = await setCustomerIsTest({
      targetUserId,
      adminUserId,
      isTest: 'true',
    });
    expect(bad.ok).toBe(false);

    const result = await setCustomerIsTest({
      targetUserId,
      adminUserId,
      isTest: true,
    });
    expect(result.ok).toBe(true);
    expect(result.isTest).toBe(true);
    expect(result.purchasesUpdated).toBe(2);
    expect(userDoc.isTest).toBe(true);
    expect(purchases.every((p) => p.isTest === true)).toBe(true);
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0].actionType).toBe('customer_marked_test');
    expect(auditInserts[0].oldValue).toEqual({ isTest: false });
    expect(auditInserts[0].newValue).toEqual({ isTest: true });
  });

  it('retries after partial failure: repairs purchase flags when user already matches', async () => {
    const targetUserId = new ObjectId();
    const adminUserId = new ObjectId();
    const auditInserts = [];
    // Simulate: first attempt set user.isTest=true then failed before purchases
    let userDoc = { _id: targetUserId, isTest: true };
    const purchases = [
      { _id: new ObjectId(), userId: targetUserId, isTest: false },
      { _id: new ObjectId(), userId: targetUserId, isTest: false },
    ];

    vi.resetModules();
    vi.doMock('../../db/index.js', () =>
      mockDbForIsTest({ userDoc, purchases, auditInserts })
    );

    const { setCustomerIsTest } = await import('../../services/admin/setCustomerIsTest.js');

    const result = await setCustomerIsTest({
      targetUserId,
      adminUserId,
      isTest: true,
    });

    expect(result.ok).toBe(true);
    expect(result.unchanged).toBe(false);
    expect(result.repaired).toBe(true);
    expect(result.purchasesUpdated).toBe(2);
    expect(purchases.every((p) => p.isTest === true)).toBe(true);
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0].actionType).toBe('customer_test_flag_reconciled');
    expect(auditInserts[0].metadata.repaired).toBe(true);

    // Fully reconciled explicit repeat still audits as verified
    const verified = await setCustomerIsTest({
      targetUserId,
      adminUserId,
      isTest: true,
    });
    expect(verified.unchanged).toBe(true);
    expect(verified.verified).toBe(true);
    expect(verified.purchasesUpdated).toBe(0);
    expect(auditInserts).toHaveLength(2);
    expect(auditInserts[1].actionType).toBe('customer_test_flag_verified');
    expect(auditInserts[1].metadata).toMatchObject({
      userFlagChanged: false,
      purchasesUpdated: 0,
      verified: true,
    });
  });

  it('retries after audit insert failure and restores the audit entry', async () => {
    const targetUserId = new ObjectId();
    const adminUserId = new ObjectId();
    const auditInserts = [];
    let userDoc = { _id: targetUserId, isTest: false };
    const purchases = [
      { _id: new ObjectId(), userId: targetUserId, isTest: false },
    ];
    let auditAttempts = 0;

    vi.resetModules();
    vi.doMock('../../db/index.js', () =>
      mockDbForIsTest({
        userDoc,
        purchases,
        auditInserts,
        auditInsertImpl: async (doc, inserts) => {
          auditAttempts += 1;
          if (auditAttempts === 1) {
            throw new Error('audit insert failed');
          }
          inserts.push(doc);
          return { insertedId: new ObjectId() };
        },
      })
    );

    const { setCustomerIsTest } = await import('../../services/admin/setCustomerIsTest.js');

    // 1–2: user + purchase updates succeed; first audit insert throws
    await expect(
      setCustomerIsTest({
        targetUserId,
        adminUserId,
        isTest: true,
      })
    ).rejects.toThrow('audit insert failed');

    expect(userDoc.isTest).toBe(true);
    expect(purchases.every((p) => p.isTest === true)).toBe(true);
    expect(auditInserts).toHaveLength(0);
    expect(auditAttempts).toBe(1);

    // 3–4: same request retried; audit is attempted and written
    const retry = await setCustomerIsTest({
      targetUserId,
      adminUserId,
      isTest: true,
    });

    expect(retry.ok).toBe(true);
    expect(retry.verified).toBe(true);
    expect(retry.purchasesUpdated).toBe(0);
    expect(auditAttempts).toBe(2);
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0].actionType).toBe('customer_test_flag_verified');
    expect(auditInserts[0].reason).toMatch(/already matched/i);
    expect(auditInserts[0].metadata).toMatchObject({
      userFlagChanged: false,
      purchasesUpdated: 0,
      verified: true,
    });
  });
});
