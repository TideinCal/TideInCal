import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function makeNode(value = '') {
  const listeners = {};
  return {
    value, textContent: '', innerHTML: '', max: '', listeners,
    classList: { add: vi.fn(), remove: vi.fn() },
    addEventListener: (name, callback) => { listeners[name] = callback; },
  };
}

describe('admin Stripe history audit download control', () => {
  it('shows a counts-only Pacific-date form and sends its exact values to the protected route', () => {
    const html = readFileSync(new URL('../../views/admin/dashboard.html', import.meta.url), 'utf8');
    const script = readFileSync(new URL('../../../public/js/admin/dashboard.js', import.meta.url), 'utf8');
    expect(html).toContain('id="ssmfStripeHistoryAuditForm"');
    expect(html).toContain('Start date (Pacific)');
    expect(html).toContain('End date (Pacific)');
    expect(html).toContain('This does not contact Stripe');
    expect(html).toContain('The campaign ID is a report/export label only; it does not filter purchase records by campaign.');
    expect(html).toContain('The audit scans all stored purchases within the selected Pacific dates.');
    const nodes = Object.fromEntries([
      'adminNav', 'dashboardContent', 'ssmfBaselineForm', 'ssmfCampaignId', 'ssmfStart', 'ssmfEnd',
      'ssmfBaselineError', 'ssmfStripeHistoryAuditForm', 'ssmfStripeAuditCampaignId',
      'ssmfStripeAuditStart', 'ssmfStripeAuditEnd', 'ssmfStripeHistoryAuditError',
      'funnelReportForm', 'funnelCampaign', 'funnelStart', 'funnelEnd', 'funnelReportError',
      'funnelReportResult',
    ].map((id) => [id, makeNode()]));
    nodes.ssmfStripeAuditCampaignId.value = 'tic-2026-first-controlled-30-day';
    nodes.ssmfStripeAuditStart.value = '2025-09-13';
    nodes.ssmfStripeAuditEnd.value = '2026-09-12';
    const assign = vi.fn();
    runInNewContext(script, {
      document: { getElementById: (id) => nodes[id] },
      window: { location: { assign } },
      adminFetchJson: () => new Promise(() => {}),
      Date, URLSearchParams,
    });
    const preventDefault = vi.fn();
    nodes.ssmfStripeHistoryAuditForm.listeners.submit({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith('/api/admin/ssmf-stripe-history-audit?campaign_id=tic-2026-first-controlled-30-day&start=2025-09-13&end=2026-09-12');
    nodes.ssmfStripeAuditEnd.value = '2027-01-01';
    nodes.ssmfStripeHistoryAuditForm.listeners.submit({ preventDefault });
    expect(assign).toHaveBeenCalledOnce();
    expect(nodes.ssmfStripeHistoryAuditError.classList.remove).toHaveBeenCalledWith('d-none');
  });
});
