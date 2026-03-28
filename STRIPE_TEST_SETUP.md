# Stripe Test Environment Setup

## 🚨 CRITICAL: You're currently using LIVE Stripe keys!

Your current `.env` file has:
- `STRIPE_SECRET_KEY=sk_live_...` ← **REAL MONEY**
- Live price IDs ← **REAL PAYMENTS**

## 🧪 Switch to Test Mode

### Step 1: Stripe Dashboard
1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. **Toggle to Test Mode** (top left corner)
3. Go to **Products** → Create test products:
   - "Single Station (Test)" - $5.00 one-time
   - "Unlimited Locations (Test)" - $29.00 one-time
4. Copy the test price IDs (start with `price_`)

### Step 2: Get Test Keys
1. In Test Mode, go to **Developers** → **API keys**
2. Copy the **Test secret key** (starts with `sk_test_`)
3. Set up test webhook endpoint

### Step 3: Update .env File
Replace your current Stripe variables with test values:

```bash
# TEST MODE - Safe for development
STRIPE_SECRET_KEY=sk_test_YOUR_TEST_SECRET_KEY_HERE
STRIPE_WEBHOOK_SECRET=whsec_YOUR_TEST_WEBHOOK_SECRET_HERE
STRIPE_PRICE_SINGLE=price_YOUR_TEST_SINGLE_PRICE_ID_HERE
STRIPE_PRICE_UNLIMITED=price_YOUR_TEST_UNLIMITED_PRICE_ID_HERE
```

### Step 4: Test Webhook Setup
1. Install Stripe CLI: `brew install stripe/stripe-cli/stripe`
2. Login: `stripe login`
3. Forward webhooks: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
4. Copy the webhook secret from the CLI output

## 🧪 Testing Benefits

With test mode you can:
- ✅ Use test card numbers (4242 4242 4242 4242)
- ✅ Test all payment scenarios
- ✅ No real money charged
- ✅ Test webhooks safely
- ✅ Reset data easily

## 🔄 Switching Between Modes

- **Development**: Use test keys
- **Production**: Use live keys (only when ready to go live)

