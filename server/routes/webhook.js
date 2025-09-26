// server/routes/webhook.js (ESM)
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Main webhook handler (mount with express.raw in server.js)
export default async function webhookHandler(req, res) {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    // req.body MUST be the raw buffer from express.raw({ type: 'application/json' })
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[webhook] signature verification failed:', err?.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    console.log('[webhook] event:', event.type, event.id);
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object; // { id, customer_email, metadata, ... }
      // Call existing logic to update user, create purchase, generate ICS, email via Resend
      const { handleCheckoutCompleted } = await import('../services/checkoutCompleted.js');
      await handleCheckoutCompleted(session);
    }
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('[webhook] processing error:', e);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}
