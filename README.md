# TideInCal

Get 12 months of tide times from official stations—synced directly to your Google or Apple Calendar. No app. No clutter. One Download. Just tides.

## Quick Start

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Environment setup**
   ```bash
   cp .env.example .env
   # Edit .env with your values:
   # - MONGO_URI: MongoDB Atlas connection string
   # - SESSION_SECRET: Random secret for sessions
   # - STRIPE_SECRET_KEY: Stripe secret key
   # - STRIPE_WEBHOOK_SECRET: Stripe webhook secret
   # - STRIPE_PRICE_*: Stripe price IDs
   # - APP_URL: Your app URL
   # - RESEND_API_KEY: Resend API key for emails
   ```

3. **Run development server**
   ```bash
   npm run dev
   ```

4. **Setup webhook (for testing)**
   ```bash
   npm run ngrok
   # Set Stripe webhook endpoint to: https://<ngrok-url>/api/stripe/webhook
   ```

5. **Configure Stripe**
   - Create products in Stripe dashboard
   - Set price IDs in `.env`
   - Configure webhook endpoint

6. **Configure Resend**
   - Verify your domain in Resend dashboard
   - Set sender email in email templates

## Development

See `docs/DEV.md` for detailed development setup instructions.

