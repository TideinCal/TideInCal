/**
 * Requires an authenticated session user with role === 'admin'.
 * Must run after attachUser (or equivalent that sets req.user).
 */
export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/**
 * Same as requireAdmin but for server-rendered admin HTML routes: redirect or plain 403.
 */
export function requireAdminPage(req, res, next) {
  if (!req.user) {
    return res.redirect(302, '/');
  }
  if (req.user.role !== 'admin') {
    return res.status(403).type('text/plain').send('Admin access required.');
  }
  next();
}
