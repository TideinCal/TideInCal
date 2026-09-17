import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const audit = {
  schema_version: 1,
  source: 'tide_app_stripe_history_audit',
  window: { start_date: '2025-09-15', end_date: '2026-09-14', time_zone: 'America/Vancouver' },
  export_context: { campaign_id: 'tic-2026-first-controlled-30-day', neutral_export: true },
  counts: { local_purchase_rows: 2 },
  privacy: { customer_rows_emitted: false, direct_identifiers_emitted: false, full_postal_codes_emitted: false },
};

async function makeApp(user, implementation = async () => audit) {
  vi.resetModules();
  vi.doMock('../../db/index.js', () => ({ getDatabase: () => ({}) }));
  vi.doMock('../../services/admin/getSsmfStripeHistoryAudit.js', () => ({ getSsmfStripeHistoryAudit: implementation }));
  const { default: adminApi } = await import('../adminApi.js');
  const app = express();
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/admin', adminApi);
  return app;
}

describe('GET /api/admin/ssmf-stripe-history-audit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects unauthenticated and non-admin reads before invoking the service', async () => {
    for (const [user, expectedStatus] of [[null, 401], [{ role: 'customer' }, 403]]) {
      const implementation = vi.fn(async () => audit);
      const app = await makeApp(user, implementation);
      const response = await request(app).get('/api/admin/ssmf-stripe-history-audit');
      expect(response.status).toBe(expectedStatus);
      expect(implementation).not.toHaveBeenCalled();
    }
  });

  it('provides an aggregate-only attachment to an admin', async () => {
    const implementation = vi.fn(async () => audit);
    const app = await makeApp({ role: 'admin' }, implementation);
    const response = await request(app).get('/api/admin/ssmf-stripe-history-audit?campaign_id=tic-2026-first-controlled-30-day&start=2025-09-15&end=2026-09-14');
    expect(response.status).toBe(200);
    expect(response.type).toBe('application/json');
    expect(response.headers['content-disposition']).toContain('ssmf-stripe-history-audit-tic-2026-first-controlled-30-day-2025-09-15-to-2026-09-14.json');
    expect(response.body).toEqual(audit);
    expect(implementation).toHaveBeenCalledWith({}, expect.objectContaining({ campaign_id: audit.export_context.campaign_id }));
  });

  it('reports bounded-date errors without returning an audit', async () => {
    const app = await makeApp({ role: 'admin' }, async () => { throw new TypeError('date range must be ordered'); });
    const response = await request(app).get('/api/admin/ssmf-stripe-history-audit?start=bad');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'date range must be ordered' });
  });
});
