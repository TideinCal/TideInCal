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

async function load() {
  const el = document.getElementById('dashboardContent');
  el.innerHTML = '<p class="text-muted">Loading…</p>';
  try {
    const data = await adminFetchJson('/api/admin/dashboard');
    el.innerHTML = `
      <div class="row g-3">
        <div class="col-md-6">
          <div class="card shadow-sm">
            <div class="card-body">
              <h2 class="h5 card-title">Total users</h2>
              <p class="display-6 mb-0">${data.totalUsers}</p>
              <p class="small text-muted mb-0">Business accounts only (excludes test)</p>
            </div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card shadow-sm">
            <div class="card-body">
              <h2 class="h5 card-title">Active subscribers</h2>
              <p class="display-6 mb-0">${data.activeSubscribers}</p>
              <p class="small text-muted mb-0">Business only: subscriptionStatus active and period end in the future</p>
            </div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card shadow-sm border-info">
            <div class="card-body">
              <h2 class="h5 card-title">Test users</h2>
              <p class="display-6 mb-0">${data.testActivity?.totalUsers ?? 0}</p>
              <p class="small text-muted mb-0">Test activity (not included in business totals)</p>
            </div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card shadow-sm border-info">
            <div class="card-body">
              <h2 class="h5 card-title">Test active subscribers</h2>
              <p class="display-6 mb-0">${data.testActivity?.activeSubscribers ?? 0}</p>
              <p class="small text-muted mb-0">Test activity (not included in business totals)</p>
            </div>
          </div>
        </div>
      </div>`;
  } catch (e) {
    el.innerHTML = `<div class="alert alert-danger">${escapeHtml(e.message || String(e))}</div>`;
  }
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

load();
