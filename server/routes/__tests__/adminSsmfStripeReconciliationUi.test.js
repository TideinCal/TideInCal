import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function node(value = '') {
  const listeners = {};
  return { value, textContent: '', innerHTML: '', max: '', listeners, classList: { add: vi.fn(), remove: vi.fn() },
    addEventListener: (name, callback) => { listeners[name] = callback; } };
}

describe('admin historical Stripe reconciliation control', () => {
  it('preserves existing controls and exposes only the fixed-window aggregate live-read action', () => {
    const html = readFileSync(new URL('../../views/admin/dashboard.html', import.meta.url), 'utf8');
    const script = readFileSync(new URL('../../../public/js/admin/dashboard.js', import.meta.url), 'utf8');
    expect(html).toContain('id="ssmfStripeHistoryAuditForm"');
    expect(html).toContain('id="funnelReportForm"');
    expect(html).toContain('id="ssmfStripeReconciliationForm"');
    expect(html).toContain('report label only; it is not a live campaign filter');
    expect(html).toContain('live, read-only Stripe lookup');
    expect(html).toContain('no raw rows leave the server');
    const ids = [
      'adminNav', 'dashboardContent', 'ssmfBaselineForm', 'ssmfCampaignId', 'ssmfStart', 'ssmfEnd', 'ssmfBaselineError',
      'ssmfStripeHistoryAuditForm', 'ssmfStripeAuditCampaignId', 'ssmfStripeAuditStart', 'ssmfStripeAuditEnd', 'ssmfStripeHistoryAuditError',
      'ssmfStripeReconciliationForm', 'ssmfStripeReconciliationCampaignId', 'ssmfStripeReconciliationStart',
      'ssmfStripeReconciliationEnd', 'ssmfStripeReconciliationError',
      'funnelReportForm', 'funnelCampaign', 'funnelStart', 'funnelEnd', 'funnelReportError', 'funnelReportResult',
    ];
    const nodes = Object.fromEntries(ids.map((id) => [id, node()]));
    nodes.ssmfStripeReconciliationCampaignId.value = 'tic-2026-first-controlled-30-day';
    nodes.ssmfStripeReconciliationStart.value = '2025-09-13';
    nodes.ssmfStripeReconciliationEnd.value = '2026-09-12';
    const assign = vi.fn();
    runInNewContext(script, {
      document: { getElementById: (id) => nodes[id] }, window: { location: { assign } },
      adminFetchJson: () => new Promise(() => {}), Date, URLSearchParams,
    });
    nodes.ssmfStripeReconciliationForm.listeners.submit({ preventDefault: vi.fn() });
    expect(assign).toHaveBeenCalledWith(
      '/api/admin/ssmf-stripe-reconciliation?campaign_id=tic-2026-first-controlled-30-day&start=2025-09-13&end=2026-09-12'
    );
    nodes.ssmfStripeReconciliationEnd.value = '2026-09-13';
    nodes.ssmfStripeReconciliationForm.listeners.submit({ preventDefault: vi.fn() });
    expect(assign).toHaveBeenCalledOnce();
    expect(nodes.ssmfStripeReconciliationError.classList.remove).toHaveBeenCalledWith('d-none');
  });
});
