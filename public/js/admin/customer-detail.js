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

function formatAdminProfile(p) {
  if (!p) return '—';
  const name = [p.firstName, p.lastName].filter(Boolean).join(' ').trim();
  return name || p.email || '—';
}

function parseUserIdFromPath() {
  const m = window.location.pathname.match(/\/admin\/customers\/([^/]+)\/?$/);
  return m ? decodeURIComponent(m[1]) : null;
}

function previewJson(val) {
  if (val === undefined || val === null) return '—';
  try {
    const s = typeof val === 'object' ? JSON.stringify(val) : String(val);
    return s.length > 120 ? `${escapeHtml(s.slice(0, 120))}…` : escapeHtml(s);
  } catch {
    return '—';
  }
}

function renderCustomer(data) {
  const main = document.getElementById('customerMain');
  const u = data.user;
  const idStr =
    u._id && typeof u._id === 'object' && u._id.toString ? u._id.toString() : String(u._id);
  const sub = data.subscriptionSummary || {};
  const marked = !!u.markedForReview;

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

  const notes = data.notes || [];
  const noteRows = notes
    .map((n) => {
      const when = n.createdAt ? escapeHtml(new Date(n.createdAt).toLocaleString()) : '—';
      const who = escapeHtml(formatAdminProfile(n.createdByProfile));
      const text = escapeHtml(n.note || '');
      return `<tr><td class="small text-muted">${when}</td><td class="small">${who}</td><td>${text.replace(/\n/g, '<br>')}</td></tr>`;
    })
    .join('');

  const audits = data.auditLog || [];
  const auditRows = audits
    .map((a) => {
      const when = a.createdAt ? escapeHtml(new Date(a.createdAt).toLocaleString()) : '—';
      const who = escapeHtml(formatAdminProfile(a.adminProfile));
      const act = escapeHtml(a.actionType || '—');
      const oldV = previewJson(a.oldValue);
      const newV = previewJson(a.newValue);
      return `<tr><td class="small text-muted">${when}</td><td class="small">${who}</td><td><code class="small">${act}</code></td><td class="small">${oldV}</td><td class="small">${newV}</td></tr>`;
    })
    .join('');

  main.innerHTML = `
      <h1 class="h3 mb-3">${escapeHtml(formatName(u))}</h1>
      <div class="card mb-3 shadow-sm ${marked ? 'border-warning' : ''}">
        <div class="card-header d-flex justify-content-between align-items-center">
          <span>Review flag</span>
          ${marked ? '<span class="badge bg-warning text-dark">Marked for review</span>' : '<span class="badge bg-secondary">Not marked</span>'}
        </div>
        <div class="card-body">
          <p class="small text-muted mb-2">Internal support flag on this user (stored on the user document).</p>
          <button type="button" class="btn btn-sm ${marked ? 'btn-outline-secondary' : 'btn-warning'}" id="toggleReviewBtn">
            ${marked ? 'Unmark for review' : 'Mark for review'}
          </button>
          <span class="small text-muted ms-2" id="reviewStatusMsg"></span>
        </div>
      </div>
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
      <div class="card mb-3 shadow-sm">
        <div class="card-header">Internal notes</div>
        <div class="card-body">
          <form id="adminNoteForm" class="mb-3">
            <label for="noteText" class="form-label small">Add a note</label>
            <textarea class="form-control form-control-sm" id="noteText" name="note" rows="3" maxlength="8000" required placeholder="Support context (visible to admins only)"></textarea>
            <button type="submit" class="btn btn-primary btn-sm mt-2" id="noteSubmitBtn">Save note</button>
            <span class="small text-muted ms-2" id="noteStatusMsg"></span>
          </form>
          <div class="table-responsive">
            <table class="table table-sm table-striped">
              <thead><tr><th>When</th><th>Author</th><th>Note</th></tr></thead>
              <tbody>${noteRows || '<tr><td colspan="3" class="text-muted">No notes yet.</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="card mb-3 shadow-sm">
        <div class="card-header">Audit log (this customer)</div>
        <div class="card-body p-0">
          <div class="table-responsive">
            <table class="table table-sm mb-0">
              <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Old</th><th>New</th></tr></thead>
              <tbody>${auditRows || '<tr><td colspan="5" class="text-muted p-3">No audit entries yet.</td></tr>'}</tbody>
            </table>
          </div>
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

  const userId = parseUserIdFromPath();

  document.getElementById('toggleReviewBtn').addEventListener('click', async () => {
    const btn = document.getElementById('toggleReviewBtn');
    const msg = document.getElementById('reviewStatusMsg');
    msg.textContent = '';
    btn.disabled = true;
    try {
      await adminPostJson(`/api/admin/customers/${encodeURIComponent(userId)}/mark-for-review`, {
        markedForReview: !marked,
      });
      msg.textContent = 'Saved.';
      await load();
    } catch (e) {
      msg.textContent = e.message || String(e);
      msg.classList.add('text-danger');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('adminNoteForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = document.getElementById('noteSubmitBtn');
    const msg = document.getElementById('noteStatusMsg');
    const ta = document.getElementById('noteText');
    msg.textContent = '';
    msg.classList.remove('text-danger');
    btn.disabled = true;
    try {
      await adminPostJson(`/api/admin/customers/${encodeURIComponent(userId)}/notes`, {
        note: ta.value.trim(),
      });
      ta.value = '';
      msg.textContent = 'Note saved.';
      await load();
    } catch (e) {
      msg.textContent = e.message || String(e);
      msg.classList.add('text-danger');
    } finally {
      btn.disabled = false;
    }
  });
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
    renderCustomer(data);
  } catch (e) {
    main.innerHTML = `<div class="alert alert-danger">${escapeHtml(e.message || String(e))}</div>`;
  }
}

load();
