import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const report = {
  source: 'tide_app_ssmf_stripe_reconciliation',
  export_context: { campaign_id: 'tic-2026-first-controlled-30-day' },
  counts: { local_candidate_rows: 1 },
  privacy: { customer_rows_emitted: false, direct_identifiers_emitted: false },
};

async function makeApp(user, implementation = async () => report) {
  vi.resetModules();
  vi.doMock('../../db/index.js', () => ({ getDatabase: () => ({}) }));
  vi.doMock('../../services/admin/getSsmfStripeReconciliation.js', () => ({ getSsmfStripeReconciliation: implementation }));
  const { default: adminApi } = await import('../adminApi.js');
  const app = express();
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/admin', adminApi);
  return app;
}

describe('GET /api/admin/ssmf-stripe-reconciliation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires an admin before a live Stripe reconciliation can be requested', async () => {
    for (const [user, status] of [[null, 401], [{ role: 'customer' }, 403]]) {
      const implementation = vi.fn(async () => report);
      const response = await request(await makeApp(user, implementation)).get('/api/admin/ssmf-stripe-reconciliation');
      expect(response.status).toBe(status);
      expect(implementation).not.toHaveBeenCalled();
    }
  });

  it('returns only the aggregate attachment for an explicit admin request', async () => {
    const implementation = vi.fn(async () => report);
    const response = await request(await makeApp({ role: 'admin' }, implementation))
      .get('/api/admin/ssmf-stripe-reconciliation?campaign_id=tic-2026-first-controlled-30-day&start=2025-09-13&end=2026-09-12');
    expect(response.status).toBe(200);
    expect(response.body).toEqual(report);
    expect(response.headers['content-disposition']).toContain(
      'ssmf-stripe-reconciliation-tic-2026-first-controlled-30-day-2025-09-13-to-2026-09-12.json'
    );
    expect(implementation).toHaveBeenCalledWith({}, expect.objectContaining({ start: '2025-09-13', end: '2026-09-12' }));
  });

  it('returns a bounded validation error without a report', async () => {
    const app = await makeApp({ role: 'admin' }, async () => { throw new TypeError('historical reconciliation is limited'); });
    const response = await request(app).get('/api/admin/ssmf-stripe-reconciliation?start=bad');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'historical reconciliation is limited' });
  });
});
