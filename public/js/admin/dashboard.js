function adminNav() {
  return `
    <nav class="navbar navbar-dark bg-dark mb-4">
      <div class="container-fluid">
        <span class="navbar-brand">TideInCal Admin</span>
        <div class="d-flex gap-2">
          <a class="btn btn-outline-light btn-sm" href="/admin">Dashboard</a>
          <a class="btn btn-outline-light btn-sm" href="/admin/customers">Customers</a>
          <a class="btn btn-outline-secondary btn-sm" href="/">Site</a>
        </div>
      </div>
    </nav>`;
}

document.getElementById('adminNav').innerHTML = adminNav();

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function metricCard({ title, value, description, borderClass = '' }) {
  return `
    <div class="col-md-6">
      <div class="card shadow-sm ${borderClass}">
        <div class="card-body">
          <h2 class="h5 card-title">${escapeHtml(title)}</h2>
          <p class="display-6 mb-0">${escapeHtml(String(value ?? 0))}</p>
          <p class="small text-muted mb-0">${escapeHtml(description)}</p>
        </div>
      </div>
    </div>`;
}

function setupSsmfBaselineDownload() {
  const form = document.getElementById('ssmfBaselineForm');
  const campaign = document.getElementById('ssmfCampaignId');
  const start = document.getElementById('ssmfStart');
  const end = document.getElementById('ssmfEnd');
  const error = document.getElementById('ssmfBaselineError');
  const today = new Date();
  const todayString = localDateString(today);
  const defaultStart = new Date(today);
  defaultStart.setDate(today.getDate() - 6);

  start.value = localDateString(defaultStart);
  end.value = todayString;
  start.max = todayString;
  end.max = todayString;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    error.classList.add('d-none');
    const campaignId = campaign.value.trim();
    const startDate = start.value;
    const endDate = end.value;
    const rangeDays = (new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86400000 + 1;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(campaignId) || !startDate || !endDate || rangeDays < 1 || rangeDays > 365) {
      error.textContent = 'Enter a lowercase hyphen-separated campaign ID and a valid non-future date range of at most 365 days.';
      error.classList.remove('d-none');
      return;
    }

    const params = new URLSearchParams({ campaign_id: campaignId, start: startDate, end: endDate });
    window.location.assign(`/api/admin/ssmf-baseline?${params.toString()}`);
  });
}

function setupSsmfStripeHistoryAuditDownload() {
  const form = document.getElementById('ssmfStripeHistoryAuditForm');
  const campaign = document.getElementById('ssmfStripeAuditCampaignId');
  const start = document.getElementById('ssmfStripeAuditStart');
  const end = document.getElementById('ssmfStripeAuditEnd');
  const error = document.getElementById('ssmfStripeHistoryAuditError');
  const todayString = localDateString(new Date());
  start.max = todayString;
  end.max = todayString;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    error.classList.add('d-none');
    const campaignId = campaign.value.trim();
    const startDate = start.value;
    const endDate = end.value;
    const rangeDays = (new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86400000 + 1;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(campaignId) || !startDate || !endDate ||
        endDate > todayString || rangeDays < 1 || rangeDays > 365) {
      error.textContent = 'Enter a valid campaign ID and Pacific date range of at most 365 days ending no later than today.';
      error.classList.remove('d-none');
      return;
    }
    const params = new URLSearchParams({ campaign_id: campaignId, start: startDate, end: endDate });
    window.location.assign(`/api/admin/ssmf-stripe-history-audit?${params.toString()}`);
  });
}

function setupSsmfStripeReconciliationDownload() {
  const form = document.getElementById('ssmfStripeReconciliationForm');
  if (!form) return;
  const campaign = document.getElementById('ssmfStripeReconciliationCampaignId');
  const start = document.getElementById('ssmfStripeReconciliationStart');
  const end = document.getElementById('ssmfStripeReconciliationEnd');
  const error = document.getElementById('ssmfStripeReconciliationError');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    error.classList.add('d-none');
    const campaignId = campaign.value.trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(campaignId) ||
        start.value !== '2025-09-13' || end.value !== '2026-09-12') {
      error.textContent = 'Enter a valid campaign ID. This protected reconciliation uses its fixed historical Pacific date window.';
      error.classList.remove('d-none');
      return;
    }
    const params = new URLSearchParams({ campaign_id: campaignId, start: start.value, end: end.value });
    window.location.assign(`/api/admin/ssmf-stripe-reconciliation?${params.toString()}`);
  });
}

function setupFunnelReport() {
  const form = document.getElementById('funnelReportForm');
  const campaign = document.getElementById('funnelCampaign');
  const start = document.getElementById('funnelStart');
  const end = document.getElementById('funnelEnd');
  const error = document.getElementById('funnelReportError');
  const result = document.getElementById('funnelReportResult');
  const today = new Date();
  const todayString = localDateString(today);
  const defaultStart = new Date(today);
  defaultStart.setDate(today.getDate() - 7);

  start.value = localDateString(defaultStart);
  end.value = todayString;
  start.max = todayString;
  end.max = todayString;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.classList.add('d-none');
    result.innerHTML = '<p class="text-muted mb-0">Loading…</p>';
    const campaignId = campaign.value.trim();
    const startDate = start.value;
    const endDate = end.value;
    const rangeDays = (new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86400000;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(campaignId) || !startDate || !endDate || rangeDays <= 0 || rangeDays > 31) {
      result.innerHTML = '';
      error.textContent = 'Enter a lowercase hyphen-separated campaign and an ordered date range of at most 31 days. The end date is excluded.';
      error.classList.remove('d-none');
      return;
    }

    try {
      const params = new URLSearchParams({ campaign: campaignId, start: startDate, end: endDate });
      const data = await adminFetchJson(`/api/admin/funnel?${params.toString()}`);
      const rows = data.contentBreakdown || [];
      if (!rows.length) {
        result.innerHTML = '<p class="text-muted mb-0">No eligible attributed funnel activity or local purchases were recorded for this campaign and range.</p>';
        return;
      }
      result.innerHTML = `
        <div class="table-responsive">
          <table class="table table-sm align-middle mb-0">
            <thead><tr>
              <th scope="col">Post/content</th><th scope="col">Tagged landings</th>
              <th scope="col">Product selections</th><th scope="col">Completed signups</th>
              <th scope="col">Checkout starts</th><th scope="col">Local purchases</th>
            </tr></thead>
            <tbody>${rows.map((row) => `<tr>
              <th scope="row">${escapeHtml(row.content === 'unknown' ? 'Unknown post/content' : row.content)}</th>
              <td>${escapeHtml(String(row.taggedJourneys))}</td>
              <td>${escapeHtml(String(row.selectedJourneys))}</td>
              <td>${escapeHtml(String(row.completedSignups))}</td>
              <td>${escapeHtml(String(row.checkoutJourneys))}</td>
              <td>${escapeHtml(String(row.localPurchases))}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
        <p class="small text-muted mb-0 mt-2">Journey steps are deduplicated within each content label. A journey touching two tagged posts can appear once under each, so per-post rows are not necessarily additive to the campaign unique-journey total. Local purchases are assigned by stored last-touch content. Unknown post/content is shown separately; it is not assigned by date. Counts are aggregate-only and do not include customer rows or identifiers.</p>`;
    } catch (e) {
      result.innerHTML = '';
      error.textContent = e.message || String(e);
      error.classList.remove('d-none');
    }
  });
}

async function load() {
  const el = document.getElementById('dashboardContent');
  el.innerHTML = '<p class="text-muted">Loading…</p>';
  try {
    const data = await adminFetchJson('/api/admin/dashboard');
    const business = data.business || {};
    const testActivity = data.testActivity || {};

    el.innerHTML = `
      <h2 class="h4 mb-3">Business metrics</h2>
      <div class="row g-3 mb-4">
        ${metricCard({
          title: 'All registered accounts',
          value: business.registeredAccounts,
          description:
            'Non-test accounts only. May include legacy unverified or bot-created registrations from before signup safeguards. Not a count of real people or paying customers.',
        })}
        ${metricCard({
          title: 'Verified email accounts',
          value: business.verifiedEmailAccounts,
          description: 'Non-test users with a real emailVerifiedAt date.',
        })}
        ${metricCard({
          title: 'Paying customers',
          value: business.payingCustomers,
          description:
            'Distinct non-test users with at least one completed local purchase whose amount is greater than zero and not fully refunded.',
        })}
        ${metricCard({
          title: 'Active subscribers',
          value: business.activeSubscribers,
          description:
            'Non-test users with subscriptionStatus active and subscriptionCurrentPeriodEnd in the future.',
        })}
      </div>
      <h2 class="h4 mb-3">Test activity</h2>
      <div class="row g-3">
        ${metricCard({
          title: 'Test registered accounts',
          value: testActivity.registeredAccounts,
          description: 'Explicitly marked test accounts (not included in business metrics).',
          borderClass: 'border-info',
        })}
        ${metricCard({
          title: 'Test active subscribers',
          value: testActivity.activeSubscribers,
          description: 'Test accounts with an active subscription period (not included in business metrics).',
          borderClass: 'border-info',
        })}
      </div>`;
  } catch (e) {
    el.innerHTML = `<div class="alert alert-danger">${escapeHtml(e.message || String(e))}</div>`;
  }
}

setupSsmfBaselineDownload();
setupSsmfStripeHistoryAuditDownload();
setupSsmfStripeReconciliationDownload();
setupFunnelReport();
load();
