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

function statusBadges(u) {
  const parts = [];
  parts.push(
    u.emailVerified
      ? '<span class="badge bg-success">Verified</span>'
      : '<span class="badge bg-secondary">Unverified</span>'
  );
  parts.push(
    u.payingCustomer
      ? '<span class="badge bg-primary">Paying</span>'
      : '<span class="badge bg-secondary">Non-paying</span>'
  );
  parts.push(
    u.subscriptionActive
      ? '<span class="badge bg-success">Active sub</span>'
      : '<span class="badge bg-secondary">No active sub</span>'
  );
  if (u.isTest) {
    parts.push('<span class="badge bg-info text-dark">Test</span>');
  }
  return parts.join(' ');
}

let currentPage = 1;
let currentQuery = '';

async function loadCustomers({ query = currentQuery, page = currentPage } = {}) {
  const resultsEl = document.getElementById('searchResults');
  resultsEl.innerHTML = '<p class="text-muted">Loading…</p>';
  currentQuery = query;
  currentPage = page;

  try {
    const params = new URLSearchParams();
    if (query.trim()) params.set('query', query.trim());
    params.set('page', String(page));
    params.set('limit', '25');

    const data = await adminFetchJson(`/api/admin/customers?${params.toString()}`);
    const rows = data.customers || [];
    const pagination = data.pagination || {};

    if (rows.length === 0) {
      resultsEl.innerHTML = `
        <p class="text-muted mb-2">${query.trim() ? 'No customers found.' : 'No account records yet.'}</p>
        ${renderPager(pagination)}`;
      return;
    }

    const tableRows = rows
      .map((u) => {
        const id = u._id;
        const idStr =
          typeof id === 'object' && id !== null ? id.toString?.() || String(id) : String(id);
        return `<tr>
          <td><a href="/admin/customers/${encodeURIComponent(idStr)}">${escapeHtml(formatName(u))}</a></td>
          <td>${escapeHtml(u.email || '—')}</td>
          <td><code class="small">${escapeHtml(idStr)}</code></td>
          <td><code class="small">${escapeHtml(u.stripeCustomerId || '—')}</code></td>
          <td class="small">${statusBadges(u)}</td>
          <td>${u.createdAt ? escapeHtml(new Date(u.createdAt).toLocaleString()) : '—'}</td>
        </tr>`;
      })
      .join('');

    resultsEl.innerHTML = `
      <p class="small text-muted mb-2">
        Showing page ${escapeHtml(String(pagination.page || page))} of
        ${escapeHtml(String(pagination.totalPages || 1))}
        (${escapeHtml(String(pagination.total ?? rows.length))} total)
      </p>
      <div class="table-responsive">
        <table class="table table-sm table-striped align-middle">
          <thead><tr>
            <th>Name</th><th>Email</th><th>User ID</th><th>Stripe customer</th><th>Status</th><th>Created</th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
      ${renderPager(pagination)}`;

    bindPager(pagination);
  } catch (e) {
    resultsEl.innerHTML = `<div class="alert alert-danger">${escapeHtml(e.message || String(e))}</div>`;
  }
}

function renderPager(pagination) {
  const hasPrev = !!pagination.hasPrevious;
  const hasNext = !!pagination.hasNext;
  return `
    <div class="d-flex gap-2 mt-3" id="customerPager">
      <button type="button" class="btn btn-outline-secondary btn-sm" id="prevPageBtn" ${hasPrev ? '' : 'disabled'}>Previous</button>
      <button type="button" class="btn btn-outline-secondary btn-sm" id="nextPageBtn" ${hasNext ? '' : 'disabled'}>Next</button>
    </div>`;
}

function bindPager(pagination) {
  const prev = document.getElementById('prevPageBtn');
  const next = document.getElementById('nextPageBtn');
  if (prev) {
    prev.addEventListener('click', () => {
      if (pagination.hasPrevious) {
        loadCustomers({ query: currentQuery, page: (pagination.page || 1) - 1 });
      }
    });
  }
  if (next) {
    next.addEventListener('click', () => {
      if (pagination.hasNext) {
        loadCustomers({ query: currentQuery, page: (pagination.page || 1) + 1 });
      }
    });
  }
}

document.getElementById('searchForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const q = document.getElementById('queryInput').value;
  loadCustomers({ query: q, page: 1 });
});

const params = new URLSearchParams(window.location.search);
const initialQ = params.get('query') || '';
const initialPage = Number(params.get('page')) || 1;
if (initialQ) {
  document.getElementById('queryInput').value = initialQ;
}
loadCustomers({ query: initialQ, page: initialPage });
