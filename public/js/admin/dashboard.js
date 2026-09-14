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
load();
