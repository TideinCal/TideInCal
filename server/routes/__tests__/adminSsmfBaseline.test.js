import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const baseline = {
  schema_version: 1,
  source: 'tide_app_aggregate',
  window: { start_date: '2026-09-01', end_date: '2026-09-13' },
  totals: [],
  grouped_counts: [],
  privacy: { customer_rows_emitted: false, direct_identifiers_emitted: false, minimum_group_size: 3 },
  limitations: ['Synthetic test limitation.'],
  proposed_uses: ['summarize_baseline'],
  export_context: {
    neutral_export: true,
    raw_export_approved: false,
    raw_export_accepted_by_tidy: false,
    campaign_id: 'fall-2026',
  },
};

async function makeApp(user, implementation = async () => baseline) {
  vi.resetModules();
  vi.doMock('../../db/index.js', () => ({ getDatabase: () => ({}) }));
  vi.doMock('../../services/admin/getSsmfBaseline.js', () => ({ getSsmfBaseline: implementation }));
  const { default: adminApi } = await import('../adminApi.js');
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/admin', adminApi);
  return app;
}

describe('GET /api/admin/ssmf-baseline', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects an unauthenticated request before invoking the aggregate service', async () => {
    const aggregate = vi.fn(async () => baseline);
    const app = await makeApp(null, aggregate);
    const response = await request(app).get('/api/admin/ssmf-baseline');
    expect(response.status).toBe(401);
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('rejects a non-admin request before invoking the aggregate service', async () => {
    const aggregate = vi.fn(async () => baseline);
    const app = await makeApp({ role: 'customer' }, aggregate);
    const response = await request(app).get('/api/admin/ssmf-baseline');
    expect(response.status).toBe(403);
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('downloads the fixed aggregate JSON response for an admin', async () => {
    const aggregate = vi.fn(async () => baseline);
    const app = await makeApp({ role: 'admin' }, aggregate);
    const response = await request(app)
      .get('/api/admin/ssmf-baseline?campaign_id=fall-2026&start=2026-09-01&end=2026-09-13');

    expect(response.status).toBe(200);
    expect(response.type).toBe('application/json');
    expect(response.headers['content-disposition']).toContain(
      'attachment; filename="ssmf-baseline-fall-2026-2026-09-01-to-2026-09-13.json"'
    );
    expect(response.body).toEqual(baseline);
    expect(aggregate).toHaveBeenCalledWith({}, expect.objectContaining({ campaign_id: 'fall-2026' }));
  });

  it('returns a 400 for service date validation errors', async () => {
    const app = await makeApp({ role: 'admin' }, async () => {
      throw new TypeError('date range must be ordered');
    });
    const response = await request(app).get('/api/admin/ssmf-baseline?campaign_id=fall&start=bad&end=bad');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'date range must be ordered' });
  });
});
