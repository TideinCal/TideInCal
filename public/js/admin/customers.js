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

async function runSearch(query) {
  const resultsEl = document.getElementById('searchResults');
  resultsEl.innerHTML = '<p class="text-muted">Searching…</p>';
  try {
    const q = encodeURIComponent(query.trim());
    const data = await adminFetchJson(`/api/admin/customers?query=${q}`);
    const rows = data.customers || [];
    if (rows.length === 0) {
      resultsEl.innerHTML = '<p class="text-muted">No customers found.</p>';
      return;
    }
    const tableRows = rows
      .map((u) => {
        const id = u._id;
        const idStr = typeof id === 'object' && id !== null ? id.toString?.() || String(id) : String(id);
        return `<tr>
          <td><a href="/admin/customers/${encodeURIComponent(idStr)}">${escapeHtml(formatName(u))}</a></td>
          <td>${escapeHtml(u.email || '—')}</td>
          <td><code class="small">${escapeHtml(idStr)}</code></td>
          <td><code class="small">${escapeHtml(u.stripeCustomerId || '—')}</code></td>
          <td>${u.subscriptionActive ? '<span class="badge bg-success">Active</span>' : '<span class="badge bg-secondary">No</span>'}</td>
          <td>${u.createdAt ? escapeHtml(new Date(u.createdAt).toLocaleString()) : '—'}</td>
        </tr>`;
      })
      .join('');
    resultsEl.innerHTML = `
      <div class="table-responsive">
        <table class="table table-sm table-striped align-middle">
          <thead><tr>
            <th>Name</th><th>Email</th><th>User ID</th><th>Stripe customer</th><th>Sub active</th><th>Created</th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>`;
  } catch (e) {
    resultsEl.innerHTML = `<div class="alert alert-danger">${escapeHtml(e.message || String(e))}</div>`;
  }
}

document.getElementById('searchForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const q = document.getElementById('queryInput').value;
  runSearch(q);
});

const params = new URLSearchParams(window.location.search);
const initialQ = params.get('query');
if (initialQ) {
  document.getElementById('queryInput').value = initialQ;
  runSearch(initialQ);
}
