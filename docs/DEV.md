# Development Setup

## Quick Start

1. **Start development server**
   ```bash
   npm run dev
   ```

2. **Setup ngrok for webhook testing**
   ```bash
   npm run ngrok
   ```
   Then set Stripe webhook endpoint to: `https://<ngrok-url>/api/stripe/webhook`

## Local Webhook Testing (Stripe CLI)

1. Start the app:
   ```bash
   npm run dev
   ```

2. In a separate terminal, start Stripe CLI and forward webhooks to localhost (use 127.0.0.1 to avoid IPv6 issues):

   ```bash
   stripe listen --forward-to 127.0.0.1:3000/api/stripe/webhook
   ```

   Copy the printed `whsec_...` and ensure it matches `STRIPE_WEBHOOK_SECRET` in `.env`.

3. Trigger a checkout completion test event:

   ```bash
   stripe trigger checkout.session.completed
   ```

4. Expected: server logs event; DB updated; (if configured) ICS file and email are handled.

## Environment Configuration

Create `.env` file with the following variables:

```bash
# App Configuration
APP_URL=http://localhost:3000

# Database
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/tideincal

# Session Security
SESSION_SECRET=your-super-secret-session-key

# Email Service
RESEND_API_KEY=re_your_resend_api_key

# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# Stripe Price IDs (create these in Stripe Dashboard)
STRIPE_PRICE_SINGLE_DOWNLOAD=price_xxx
STRIPE_PRICE_LUNAR_ADDON=price_xxx
STRIPE_PRICE_UNLIMITED=price_xxx

# Optional: Skip sending emails in development
MOCK_EMAILS=true
```

## Stripe Setup

1. Create products in Stripe Dashboard:
   - Single Download ($5)
   - Lunar Add-on ($2)
   - Unlimited Access ($25)

2. Get the price IDs and add them to `.env`

3. Configure webhook endpoint:
   - URL: `https://<your-domain>/api/stripe/webhook`
   - Events: `checkout.session.completed`

## Resend Setup

1. Verify your domain in Resend dashboard
2. Set sender email to `noreply@tideincal.com`
3. Add API key to `.env`

## Database Setup

The application will automatically create the necessary indexes on first run. You can also run:

```bash
node scripts/ensure-indexes.js
```

## Testing

### Offline Tests (No Network Required)
```bash
npm test
```

### Interactive Test UI
```bash
npm run test:ui
```

The offline tests use mocked Stripe webhooks and don't require external services.

## Development Workflow

1. Start the dev server: `npm run dev`
2. For webhook testing: `npm run ngrok` OR use Stripe CLI
3. Set Stripe webhook to ngrok URL or use Stripe CLI forwarding
4. Test the complete flow:
   - Sign up → Checkout → Payment → Webhook → File generation → Email

## Troubleshooting

- **Webhook not receiving events**: Ensure webhook URL is set correctly in Stripe
- **Email not sending**: Check Resend API key and domain verification
- **Database connection issues**: Verify MONGO_URI format and network access
- **Session issues**: Ensure SESSION_SECRET is set and consistent
- **Stripe CLI issues**: Make sure you're using `127.0.0.1` instead of `localhost`
- **Test failures**: Ensure `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set in `.env`
