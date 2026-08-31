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

load();
