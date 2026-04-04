/**
 * Shared admin API fetch: session cookies + consistent error handling for Phase 1–2 read APIs.
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
    throw new Error('Admin access required. Your account needs role admin.');
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
