#!/usr/bin/env node
/**
 * Verify live Pro flows with a logged-in Pro user.
 * 1. Normal tide download (POST /api/downloads/generate) → expect 200, not 403
 * 2. Golden Hour (POST /api/downloads/golden) → expect 200, not 403
 * 3. Moon download (POST /api/downloads/moon) → expect 200, not 403
 *
 * Requires server running. Set in env:
 *   PRO_USER_EMAIL    - Pro user email
 *   PRO_USER_PASSWORD - Pro user password
 *   BASE_URL          - optional, default http://localhost:3000
 *
 * Run: PRO_USER_EMAIL=... PRO_USER_PASSWORD=... node scripts/verify-pro-flows.js
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function getCookieFromResponse(res) {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return null;
  const first = setCookie.split(',')[0].trim();
  const value = first.split(';')[0].trim();
  return value || null;
}

async function main() {
  const email = process.env.PRO_USER_EMAIL;
  const password = process.env.PRO_USER_PASSWORD;

  if (!email || !password) {
    console.error('Set PRO_USER_EMAIL and PRO_USER_PASSWORD to verify with a logged-in Pro user.');
    console.error('Example: PRO_USER_EMAIL=you@example.com PRO_USER_PASSWORD=secret node scripts/verify-pro-flows.js');
    process.exit(1);
  }

  let cookie = null;
  let csrfToken = null;
  const results = { entitlements: null, tide: null, golden: null, moon: null };

  try {
    // 1) Login
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      redirect: 'manual'
    });
    cookie = getCookieFromResponse(loginRes);
    if (!cookie) {
      console.error('Login failed or no session cookie received. Status:', loginRes.status);
      const text = await loginRes.text();
      try {
        const data = JSON.parse(text);
        console.error('Response:', data);
      } catch (_) {
        console.error('Body:', text.slice(0, 200));
      }
      process.exit(1);
    }
    if (!loginRes.ok) {
      console.error('Login rejected:', loginRes.status, await loginRes.text());
      process.exit(1);
    }
    console.log('Login OK, session cookie received.');

    // 2) CSRF
    const csrfRes = await fetch(`${BASE_URL}/api/csrf`, {
      headers: { Cookie: cookie },
      credentials: 'include'
    });
    if (!csrfRes.ok) {
      console.error('CSRF request failed:', csrfRes.status);
      process.exit(1);
    }
    const csrfData = await csrfRes.json();
    csrfToken = csrfData.csrfToken;
    if (!csrfToken) {
      console.error('No csrfToken in response');
      process.exit(1);
    }
    console.log('CSRF token received.');

    // 3) Entitlements – must show Pro
    const entRes = await fetch(`${BASE_URL}/api/auth/me/entitlements`, {
      headers: { Cookie: cookie },
      credentials: 'include'
    });
    if (!entRes.ok) {
      console.error('Entitlements request failed:', entRes.status);
      process.exit(1);
    }
    const entitlements = await entRes.json();
    results.entitlements = entitlements;
    if (!entitlements.unlimited) {
      console.error('User is not Pro: unlimited =', entitlements.unlimited);
      console.error('Entitlements:', JSON.stringify(entitlements, null, 2));
      process.exit(1);
    }
    console.log('Entitlements OK: unlimited=true, subscriptionStatus=', entitlements.subscriptionStatus);

    const headers = {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
      Cookie: cookie
    };

    // 4) Tide download (subscription generate)
    const tideRes = await fetch(`${BASE_URL}/api/downloads/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        stationID: '9447130',
        stationTitle: 'Seattle',
        country: 'usa',
        includeMoon: false,
        userTimezone: 'UTC',
        feet: false,
        includeGoldenHour: false
      }),
      redirect: 'manual'
    });
    results.tide = { status: tideRes.status, ok: tideRes.ok };
    if (tideRes.status === 403) {
      const err = await tideRes.json().catch(() => ({}));
      console.error('Tide download returned 403 (would show checkout/blocked):', err);
      process.exit(1);
    }
    if (!tideRes.ok) {
      console.error('Tide download failed:', tideRes.status, await tideRes.text().then(t => t.slice(0, 200)));
      process.exit(1);
    }
    const contentType = tideRes.headers.get('content-type') || '';
    if (!contentType.includes('text/calendar') && !contentType.includes('application/octet-stream')) {
      console.error('Tide response not ICS:', contentType);
    }
    console.log('Tide download OK:', tideRes.status, 'Content-Type:', contentType.split(';')[0]);

    // 5) Golden Hour
    const goldenRes = await fetch(`${BASE_URL}/api/downloads/golden`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        lat: 47.6062,
        lng: -122.3321,
        locationName: 'Seattle',
        userTimezone: 'UTC'
      }),
      redirect: 'manual'
    });
    results.golden = { status: goldenRes.status, ok: goldenRes.ok };
    if (goldenRes.status === 403) {
      const err = await goldenRes.json().catch(() => ({}));
      console.error('Golden Hour returned 403 (would show checkout/blocked):', err);
      process.exit(1);
    }
    if (!goldenRes.ok) {
      console.error('Golden Hour failed:', goldenRes.status, await goldenRes.text().then(t => t.slice(0, 200)));
      process.exit(1);
    }
    console.log('Golden Hour OK:', goldenRes.status);

    // 6) Moon
    const moonRes = await fetch(`${BASE_URL}/api/downloads/moon`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
      redirect: 'manual'
    });
    results.moon = { status: moonRes.status, ok: moonRes.ok };
    if (moonRes.status === 403) {
      const err = await moonRes.json().catch(() => ({}));
      console.error('Moon download returned 403 (would show checkout/blocked):', err);
      process.exit(1);
    }
    if (!moonRes.ok) {
      console.error('Moon download failed:', moonRes.status, await moonRes.text().then(t => t.slice(0, 200)));
      process.exit(1);
    }
    console.log('Moon download OK:', moonRes.status);

    console.log('\n--- All Pro flows verified ---');
    console.log('1. Normal tide download: 200, no checkout/plan modal');
    console.log('2. Golden Hour:          200, no checkout/plan modal');
    console.log('3. Moon (account):      200, no checkout/plan modal');
    process.exit(0);
  } catch (err) {
    console.error('Request error:', err.message);
    if (err.cause) console.error('Cause:', err.cause);
    process.exit(1);
  }
}

main();
