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

function formatName(u) {
  const parts = [u.firstName, u.lastName].filter(Boolean);
  return parts.length ? parts.join(' ') : '—';
}

function parseUserIdFromPath() {
  const m = window.location.pathname.match(/\/admin\/customers\/([^/]+)\/?$/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function load() {
  const userId = parseUserIdFromPath();
  const main = document.getElementById('customerMain');
  if (!userId) {
    main.innerHTML = '<div class="alert alert-warning">Missing customer id.</div>';
    return;
  }
  main.innerHTML = '<p class="text-muted">Loading…</p>';
  try {
    const data = await adminFetchJson(`/api/admin/customers/${encodeURIComponent(userId)}`);
    const u = data.user;
    const idStr =
      u._id && typeof u._id === 'object' && u._id.toString ? u._id.toString() : String(u._id);
    const sub = data.subscriptionSummary || {};

    const purchaseRows = (data.purchases || [])
      .map((p) => {
        const pid = p._id && p._id.toString ? p._id.toString() : String(p._id);
        return `<tr>
          <td>${p.createdAt ? escapeHtml(new Date(p.createdAt).toLocaleString()) : '—'}</td>
          <td>${escapeHtml(p.product || '—')}</td>
          <td>${p.amount != null ? escapeHtml(String(p.amount)) : '—'}</td>
          <td>${escapeHtml(p.currency || '—')}</td>
          <td><code class="small">${escapeHtml(p.stripeSessionId || '—')}</code></td>
          <td><code class="small">${escapeHtml(p.stripeSubscriptionId || '—')}</code></td>
          <td><code class="small">${pid}</code></td>
        </tr>`;
      })
      .join('');

    main.innerHTML = `
      <h1 class="h3 mb-3">${escapeHtml(formatName(u))}</h1>
      <div class="card mb-3 shadow-sm">
        <div class="card-header">Account</div>
        <div class="card-body">
          <dl class="row mb-0 small">
            <dt class="col-sm-3">Email</dt><dd class="col-sm-9">${escapeHtml(u.email || '—')}</dd>
            <dt class="col-sm-3">User ID</dt><dd class="col-sm-9"><code>${escapeHtml(idStr)}</code></dd>
            <dt class="col-sm-3">Stripe customer</dt><dd class="col-sm-9"><code>${escapeHtml(u.stripeCustomerId || '—')}</code></dd>
            <dt class="col-sm-3">Role</dt><dd class="col-sm-9">${escapeHtml(u.role || '—')}</dd>
            <dt class="col-sm-3">Created</dt><dd class="col-sm-9">${u.createdAt ? escapeHtml(new Date(u.createdAt).toLocaleString()) : '—'}</dd>
          </dl>
        </div>
      </div>
      <div class="card mb-3 shadow-sm">
        <div class="card-header">Subscription (from user record)</div>
        <div class="card-body">
          <dl class="row mb-0 small">
            <dt class="col-sm-3">Stripe subscription</dt><dd class="col-sm-9"><code>${escapeHtml(sub.stripeSubscriptionId || '—')}</code></dd>
            <dt class="col-sm-3">Status</dt><dd class="col-sm-9">${escapeHtml(sub.subscriptionStatus || '—')}</dd>
            <dt class="col-sm-3">Current period end</dt><dd class="col-sm-9">${sub.subscriptionCurrentPeriodEnd ? escapeHtml(new Date(sub.subscriptionCurrentPeriodEnd).toLocaleString()) : '—'}</dd>
            <dt class="col-sm-3">Unlimited flag</dt><dd class="col-sm-9">${sub.unlimited ? 'true' : 'false'}</dd>
            <dt class="col-sm-3">Derived active</dt><dd class="col-sm-9">${sub.subscriptionActive ? '<span class="badge bg-success">Yes</span>' : '<span class="badge bg-secondary">No</span>'}</dd>
          </dl>
        </div>
      </div>
      <div class="card shadow-sm">
        <div class="card-header">Purchases</div>
        <div class="card-body p-0">
          <div class="table-responsive">
            <table class="table table-sm mb-0 align-middle">
              <thead><tr>
                <th>Created</th><th>Product</th><th>Amount</th><th>Currency</th><th>Session</th><th>Subscription</th><th>Purchase ID</th>
              </tr></thead>
              <tbody>${purchaseRows || '<tr><td colspan="7" class="text-muted p-3">No purchases</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>`;
    document.title = `Admin: ${formatName(u)}`;
  } catch (e) {
    main.innerHTML = `<div class="alert alert-danger">${escapeHtml(e.message || String(e))}</div>`;
  }
}

load();
