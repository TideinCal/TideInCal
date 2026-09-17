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

const ALLOWED_LIMITS = [25, 50, 100, 200];
const DEFAULT_SORT = 'created_desc';
const DEFAULT_LIMIT = 25;

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

function resolveLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  const floor = Math.floor(n);
  if (n !== floor) return DEFAULT_LIMIT;
  if (ALLOWED_LIMITS.includes(floor)) return floor;
  return DEFAULT_LIMIT;
}

function resolveSort(sort) {
  const allowed = [
    'created_desc',
    'created_asc',
    'name_asc',
    'name_desc',
    'email_asc',
    'email_desc',
    'verified_first',
    'unverified_first',
    'paying_first',
    'nonpaying_first',
    'active_first',
    'inactive_first',
  ];
  return allowed.includes(sort) ? sort : DEFAULT_SORT;
}

function resolvePage(page) {
  const n = Number(page);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

function buildPageWindow(currentPage, totalPages) {
  if (totalPages <= 0) return [];
  if (totalPages <= 9) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages = new Set([1, totalPages, currentPage, currentPage - 1, currentPage + 1, 2, totalPages - 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push(null);
    out.push(p);
    prev = p;
  }
  return out;
}

function parseStateFromLocation() {
  const params = new URLSearchParams(window.location.search);
  return {
    query: params.get('query') || '',
    page: resolvePage(params.get('page')),
    limit: resolveLimit(params.get('limit')),
    sort: resolveSort(params.get('sort')),
  };
}

function syncUrl({ query, page, limit, sort }, { replace = false } = {}) {
  const params = new URLSearchParams();
  const q = (query || '').trim();
  if (q) params.set('query', q);
  params.set('page', String(page));
  params.set('limit', String(limit));
  params.set('sort', sort);
  const qs = params.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
  const method = replace ? 'replaceState' : 'pushState';
  window.history[method]({ query, page, limit, sort }, '', url);
}

let state = parseStateFromLocation();

function syncControlsFromState() {
  document.getElementById('queryInput').value = state.query;
  document.getElementById('sortSelect').value = state.sort;
  document.getElementById('limitSelect').value = String(state.limit);
}

async function loadCustomers({ pushUrl = true, replaceUrl = false } = {}) {
  const resultsEl = document.getElementById('searchResults');
  resultsEl.innerHTML = '<p class="text-muted">Loading…</p>';
  syncControlsFromState();

  try {
    const params = new URLSearchParams();
    if (state.query.trim()) params.set('query', state.query.trim());
    params.set('page', String(state.page));
    params.set('limit', String(state.limit));
    params.set('sort', state.sort);

    const data = await adminFetchJson(`/api/admin/customers?${params.toString()}`);
    const rows = data.customers || [];
    const pagination = data.pagination || {};

    // Honor server-clamped effective values
    state.page = pagination.page || state.page;
    state.limit = pagination.limit || state.limit;
    state.sort = pagination.sort || state.sort;
    syncControlsFromState();

    if (pushUrl) {
      syncUrl(state, { replace: replaceUrl });
    }

    if (rows.length === 0) {
      resultsEl.innerHTML = `
        <p class="text-muted mb-2">${state.query.trim() ? 'No customers found.' : 'No account records yet.'}</p>
        ${
          pagination.searchPossiblyCapped
            ? `<p class="small text-warning">Search results may be incomplete (each search strategy is capped at ${escapeHtml(String(pagination.searchStrategyMatchCap || 50))} matches).</p>`
            : ''
        }
        ${renderPager(pagination)}`;
      bindPager(pagination);
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
        Showing page ${escapeHtml(String(pagination.page || state.page))} of
        ${escapeHtml(String(pagination.totalPages || 0))}
        (${escapeHtml(String(pagination.total ?? rows.length))} total)
        · sort ${escapeHtml(pagination.sort || state.sort)}
        · ${escapeHtml(String(pagination.limit || state.limit))} rows per page
      </p>
      ${
        pagination.searchPossiblyCapped
          ? `<p class="small text-warning mb-2">Search results may be incomplete (each search strategy is capped at ${escapeHtml(String(pagination.searchStrategyMatchCap || 50))} matches).</p>`
          : ''
      }
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
  const page = pagination.page || 1;
  const totalPages = pagination.totalPages || 0;
  const firstDisabled = !pagination.hasFirst;
  const prevDisabled = !pagination.hasPrevious;
  const nextDisabled = !pagination.hasNext;
  const lastDisabled = !pagination.hasLast;
  const windowPages = buildPageWindow(page, totalPages);

  const pageButtons = windowPages
    .map((p) => {
      if (p == null) {
        return `<span class="px-1 text-muted" aria-hidden="true">…</span>`;
      }
      const current = p === page;
      return `<button type="button" class="btn btn-sm ${current ? 'btn-primary' : 'btn-outline-secondary'} pageNumBtn" data-page="${p}" ${current ? 'aria-current="page"' : ''} aria-label="Page ${p}">${p}</button>`;
    })
    .join('');

  return `
    <nav class="d-flex flex-wrap gap-2 align-items-center mt-3" id="customerPager" aria-label="Customer list pagination">
      <button type="button" class="btn btn-outline-secondary btn-sm" id="firstPageBtn" ${firstDisabled ? 'disabled' : ''}>First</button>
      <button type="button" class="btn btn-outline-secondary btn-sm" id="prevPageBtn" ${prevDisabled ? 'disabled' : ''}>Previous</button>
      <div class="d-flex flex-wrap gap-1" role="group" aria-label="Page numbers">${pageButtons || '<span class="small text-muted">No pages</span>'}</div>
      <button type="button" class="btn btn-outline-secondary btn-sm" id="nextPageBtn" ${nextDisabled ? 'disabled' : ''}>Next</button>
      <button type="button" class="btn btn-outline-secondary btn-sm" id="lastPageBtn" ${lastDisabled ? 'disabled' : ''}>Last</button>
      <label class="small text-muted ms-2 mb-0" for="pageJumpSelect">Go to page</label>
      <select class="form-select form-select-sm w-auto" id="pageJumpSelect" aria-label="Go to page" ${totalPages <= 0 ? 'disabled' : ''}>
        ${
          totalPages <= 0
            ? '<option value="1">1</option>'
            : Array.from({ length: totalPages }, (_, i) => {
                const n = i + 1;
                return `<option value="${n}" ${n === page ? 'selected' : ''}>${n}</option>`;
              }).join('')
        }
      </select>
    </nav>`;
}

function bindPager(pagination) {
  const go = (page) => {
    state.page = page;
    loadCustomers({ pushUrl: true });
  };

  const first = document.getElementById('firstPageBtn');
  const prev = document.getElementById('prevPageBtn');
  const next = document.getElementById('nextPageBtn');
  const last = document.getElementById('lastPageBtn');
  const jump = document.getElementById('pageJumpSelect');

  if (first) {
    first.addEventListener('click', () => {
      if (pagination.hasFirst) go(1);
    });
  }
  if (prev) {
    prev.addEventListener('click', () => {
      if (pagination.hasPrevious) go((pagination.page || 1) - 1);
    });
  }
  if (next) {
    next.addEventListener('click', () => {
      if (pagination.hasNext) go((pagination.page || 1) + 1);
    });
  }
  if (last) {
    last.addEventListener('click', () => {
      if (pagination.hasLast) go(pagination.totalPages);
    });
  }
  document.querySelectorAll('.pageNumBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = Number(btn.getAttribute('data-page'));
      if (Number.isFinite(p)) go(p);
    });
  });
  if (jump) {
    jump.addEventListener('change', () => {
      const p = Number(jump.value);
      if (Number.isFinite(p)) go(p);
    });
  }
}

document.getElementById('searchForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  state.query = document.getElementById('queryInput').value;
  state.sort = resolveSort(document.getElementById('sortSelect').value);
  state.limit = resolveLimit(document.getElementById('limitSelect').value);
  state.page = 1;
  loadCustomers({ pushUrl: true });
});

document.getElementById('sortSelect').addEventListener('change', () => {
  state.sort = resolveSort(document.getElementById('sortSelect').value);
  state.query = document.getElementById('queryInput').value;
  state.page = 1;
  loadCustomers({ pushUrl: true });
});

document.getElementById('limitSelect').addEventListener('change', () => {
  state.limit = resolveLimit(document.getElementById('limitSelect').value);
  state.query = document.getElementById('queryInput').value;
  state.sort = resolveSort(document.getElementById('sortSelect').value);
  state.page = 1;
  loadCustomers({ pushUrl: true });
});

window.addEventListener('popstate', () => {
  state = parseStateFromLocation();
  loadCustomers({ pushUrl: false });
});

syncControlsFromState();
loadCustomers({ pushUrl: true, replaceUrl: true });
