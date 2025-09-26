// server/bootstrap/envGuard.js
export function assertStripeEnv() {
  if (process.env.VITEST) return; // allow tests to run with mocks
  const req = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
  const missing = req.filter(k => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing required Stripe env vars: ${missing.join(', ')}`);
  }
}
