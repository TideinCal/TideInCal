// test-setup.js
// Set environment variables for tests
process.env.VITEST = 'true';
process.env.NODE_ENV = 'test';
process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock';
process.env.MONGO_URI = 'mongodb://localhost:27017/tideincal_test';
process.env.APP_URL = 'http://localhost:3000';
process.env.MOCK_EMAILS = 'true';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';
process.env.ATTRIBUTION_COOKIE_SECRET =
  process.env.ATTRIBUTION_COOKIE_SECRET || 'test-attribution-secret';
