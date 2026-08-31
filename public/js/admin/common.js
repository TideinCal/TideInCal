/**
 * Shared admin API fetch: session cookies + consistent error handling.
 */
async function adminFetchJson(url, options) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(options && options.headers),
    },
    ...options,
  });
  if (res.status === 401) {
    window.location.href = '/';
    throw new Error('Authentication required');
  }
  if (res.status === 403) {
    let msg = 'Admin access required. Your account needs role admin.';
    try {
      const body = await res.clone().json();
      if (body && body.error) msg = body.error;
    } catch {
      /* plain text body */
    }
    throw new Error(msg);
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      if (body && body.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}

/**
 * Fetch CSRF token (session-based) and POST JSON to admin API.
 */
async function adminPostJson(url, body) {
  const csrfRes = await fetch('/api/csrf', { credentials: 'include' });
  if (!csrfRes.ok) {
    throw new Error('Unable to fetch CSRF token');
  }
  const { csrfToken } = await csrfRes.json();
  if (!csrfToken) {
    throw new Error('Missing CSRF token');
  }
  return adminFetchJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify(body),
  });
}
