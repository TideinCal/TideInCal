#!/usr/bin/env node
/**
 * Diagnose Stripe webhook setup: env, Stripe API, endpoint reachability, per-event handlers.
 * Usage: node scripts/verify-webhooks.js [--base-url http://127.0.0.1:3000]
 */
import dotenv from 'dotenv';
import Stripe from 'stripe';

dotenv.config();

const baseUrl = process.argv.includes('--base-url')
  ? process.argv[process.argv.indexOf('--base-url') + 1]
  : process.env.APP_URL || 'http://127.0.0.1:3000';

const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/stripe/webhook`;

function mask(s) {
  if (!s || typeof s !== 'string') return '(missing)';
  if (s.length <= 12) return `${s.slice(0, 4)}…`;
  return `${s.slice(0, 7)}…${s.slice(-4)}`;
}

function buildEvent(type, dataObject) {
  return {
    id: `evt_verify_${type.replace(/\./g, '_')}_${Date.now()}`,
    object: 'event',
    type,
    data: { object: dataObject },
    created: Math.floor(Date.now() / 1000),
    livemode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_'),
  };
}

async function postSignedEvent(stripe, secret, event) {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': signature,
    },
    body: payload,
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function main() {
  const results = [];
  const log = (section, ok, detail) => {
    results.push({ section, ok, detail });
    const icon = ok === true ? 'OK' : ok === false ? 'FAIL' : 'WARN';
    console.log(`[${icon}] ${section}: ${detail}`);
  };

  console.log('\n=== TideInCal webhook diagnostic ===\n');
  console.log(`Target URL: ${webhookUrl}\n`);

  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const commentedCliSecret = process.env.STRIPE_WEBHOOK_SECRET?.includes('cab211');

  log(
    'Environment',
    !!secretKey && !!webhookSecret,
    `STRIPE_SECRET_KEY=${mask(secretKey)} (${secretKey?.startsWith('sk_live_') ? 'LIVE' : secretKey?.startsWith('sk_test_') ? 'TEST' : 'unknown'}), STRIPE_WEBHOOK_SECRET=${mask(webhookSecret)}`
  );

  if (!secretKey || !webhookSecret) {
    console.log('\nFix missing keys in .env then re-run.\n');
    process.exit(1);
  }

  let stripe;
  try {
    stripe = new Stripe(secretKey);
    const account = await stripe.accounts.retrieve();
    log('Stripe API key', true, `Connected to account ${account.id} (${account.settings?.dashboard?.display_name || 'TideInCal'})`);
  } catch (e) {
    log('Stripe API key', false, e.message);
    console.log('\nCannot continue without a valid STRIPE_SECRET_KEY.\n');
    process.exit(1);
  }

  try {
    const endpoints = await stripe.webhookEndpoints.list({ limit: 20 });
    if (endpoints.data.length === 0) {
      log('Stripe Dashboard endpoints', false, 'No webhook endpoints configured in this Stripe account');
    } else {
      console.log('\n--- Stripe Dashboard webhook endpoints ---');
      for (const ep of endpoints.data) {
        const status = ep.status === 'enabled' ? 'enabled' : ep.status;
        console.log(`  • ${ep.url}`);
        console.log(`    status=${status}, id=${ep.id}`);
        console.log(`    events: ${(ep.enabled_events || []).join(', ')}`);
        const required = [
          'checkout.session.completed',
          'customer.subscription.updated',
          'customer.subscription.deleted',
          'charge.refunded',
        ];
        const missing = required.filter((ev) => {
          const events = ep.enabled_events || [];
          return !events.includes(ev) && !events.includes('*');
        });
        if (missing.length) {
          log(`  Endpoint ${ep.id}`, false, `Missing events: ${missing.join(', ')}`);
        } else if (ep.url.includes('localhost') && !baseUrl.includes('localhost')) {
          log(`  Endpoint ${ep.id}`, null, 'Points at localhost — production traffic will not hit your laptop');
        } else {
          log(`  Endpoint ${ep.id}`, true, 'All required event types subscribed');
        }
      }
    }
  } catch (e) {
    log('Stripe Dashboard endpoints', false, e.message);
  }

  try {
    const events = await stripe.events.list({ limit: 8 });
    console.log('\n--- Recent Stripe events (account-wide) ---');
    if (events.data.length === 0) {
      log('Recent events', null, 'No recent events in Stripe (or list empty)');
    } else {
      for (const ev of events.data) {
        console.log(`  • ${ev.created ? new Date(ev.created * 1000).toISOString() : '?'} ${ev.type} ${ev.id}`);
      }
    }
  } catch (e) {
    log('Recent events', false, e.message);
  }

  console.log('\n--- Local endpoint tests (signed with STRIPE_WEBHOOK_SECRET) ---\n');

  const eventTests = [
    {
      name: 'checkout.session.completed',
      event: buildEvent('checkout.session.completed', {
        id: 'cs_verify_test',
        mode: 'payment',
        customer: 'cus_verify',
        customer_email: 'webhook-verify@example.com',
        payment_intent: 'pi_verify',
        amount_total: 500,
        currency: 'usd',
        metadata: {
          plan: 'single',
          userId: '000000000000000000000001',
          stationID: '1',
          stationTitle: 'Webhook Test',
          country: 'usa',
        },
      }),
      note: 'Uses fake userId — expect 500 if DB connected (no user), 200 if DB down is N/A',
    },
    {
      name: 'customer.subscription.updated',
      event: buildEvent('customer.subscription.updated', {
        id: 'sub_verify_nonexistent',
        status: 'active',
        current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
        cancel_at_period_end: false,
      }),
      note: 'No matching user — handler should still return 200',
    },
    {
      name: 'customer.subscription.deleted',
      event: buildEvent('customer.subscription.deleted', {
        id: 'sub_verify_nonexistent',
        status: 'canceled',
      }),
      note: 'No matching user — handler should still return 200',
    },
    {
      name: 'charge.refunded',
      event: buildEvent('charge.refunded', {
        id: 'ch_verify_test',
        amount: 1000,
        amount_refunded: 1000,
        currency: 'usd',
      }),
      note: 'Needs MongoDB — inserts webhook_events, may skip purchase match',
    },
    {
      name: 'payment_intent.succeeded (unsupported)',
      event: buildEvent('payment_intent.succeeded', { id: 'pi_unsupported' }),
      note: 'Not handled in code — should return 200 received with no side effects',
    },
  ];

  for (const { name, event, note } of eventTests) {
    try {
      const { status, body } = await postSignedEvent(stripe, webhookSecret, event);
      const ok = status === 200;
      log(name, ok, `HTTP ${status} ${typeof body === 'object' ? JSON.stringify(body) : body} — ${note}`);
    } catch (e) {
      log(name, false, `Request failed: ${e.message} (is \`npm run dev\` running on ${baseUrl}?)`);
    }
  }

  console.log('\n--- Stripe CLI (local forwarding) ---');
  try {
    const { execSync } = await import('child_process');
    const ver = execSync('stripe --version', { encoding: 'utf8' }).trim();
    log('Stripe CLI installed', true, ver);
    console.log(
      '  For localhost: run in a second terminal:\n' +
        '    stripe listen --forward-to 127.0.0.1:3000/api/stripe/webhook\n' +
        '  Then copy the NEW whsec_... into .env as STRIPE_WEBHOOK_SECRET and restart dev server.\n' +
        '  CLI auth must match mode (test vs live). Expired sk_test in CLI causes listen to fail.'
    );
  } catch {
    log('Stripe CLI', false, 'not found');
  }

  const failed = results.filter((r) => r.ok === false);
  console.log('\n=== Summary ===');
  if (failed.length === 0) {
    console.log('No hard failures in this run. Check WARN lines and Stripe Dashboard delivery logs for production.');
  } else {
    console.log(`${failed.length} failure(s):`);
    for (const f of failed) console.log(`  - ${f.section}: ${f.detail}`);
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
