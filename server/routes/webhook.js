// server/routes/webhook.js (ESM)
import Stripe from 'stripe';
import { getDatabase } from '../db/index.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Main webhook handler (mount with express.raw in server.js)
export default async function webhookHandler(req, res) {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    // req.body MUST be the raw buffer from express.raw({ type: 'application/json' })
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log('[webhook] Signature verification successful for event:', event.type, event.id);
  } catch (err) {
    console.error('[webhook] Signature verification failed:', err?.message);
    console.error('[webhook] Webhook secret configured:', !!process.env.STRIPE_WEBHOOK_SECRET);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    console.log('[webhook] Processing event:', event.type, event.id);
    
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      console.log('[webhook] checkout.session.completed arrived for session:', session.id);
      const { handleCheckoutCompleted } = await import('../services/checkoutCompleted.js');
      await handleCheckoutCompleted(session);
      console.log('[webhook] Successfully completed processing checkout.session.completed');
    } else if (event.type === 'customer.subscription.updated') {
      // Handle subscription status changes
      const subscription = event.data.object;
      await handleSubscriptionUpdated(subscription);
    } else if (event.type === 'customer.subscription.deleted') {
      // Handle subscription cancellation
      const subscription = event.data.object;
      await handleSubscriptionDeleted(subscription);
    }
    
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('[webhook] Processing error for event:', event?.type, event?.id);
    console.error('[webhook] Error details:', e);
    console.error('[webhook] Error stack:', e.stack);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}

/**
 * Handle subscription updated event
 * Updates user subscription status and current period end
 */
async function handleSubscriptionUpdated(subscription) {
  try {
    console.log('[webhook] Processing subscription.updated:', subscription.id);
    
    const db = getDatabase();
    const { ObjectId } = await import('mongodb');
    
    // Find user by subscription ID
    const user = await db.collection('users').findOne({
      stripeSubscriptionId: subscription.id
    });
    
    if (!user) {
      console.warn('[webhook] User not found for subscription:', subscription.id);
      return;
    }
    
    const currentPeriodEnd = new Date(subscription.current_period_end * 1000);
    const isActive = subscription.status === 'active';
    
    // Update user subscription status
    await db.collection('users').updateOne(
      { _id: user._id },
      {
        $set: {
          subscriptionStatus: subscription.status,
          subscriptionCurrentPeriodEnd: currentPeriodEnd,
          unlimited: isActive,
          updatedAt: new Date()
        }
      }
    );
    
    // Update purchase record if exists
    await db.collection('purchases').updateMany(
      { stripeSubscriptionId: subscription.id },
      {
        $set: {
          subscriptionStatus: subscription.status,
          subscriptionCurrentPeriodEnd: currentPeriodEnd,
          updatedAt: new Date()
        }
      }
    );
    
    console.log('[webhook] Updated subscription status:', subscription.id, 'status:', subscription.status);
  } catch (error) {
    console.error('[webhook] Error handling subscription.updated:', error);
    throw error;
  }
}

/**
 * Handle subscription deleted event
 * Marks subscription as cancelled and removes unlimited access
 */
async function handleSubscriptionDeleted(subscription) {
  try {
    console.log('[webhook] Processing subscription.deleted:', subscription.id);
    
    const db = getDatabase();
    const { ObjectId } = await import('mongodb');
    
    // Find user by subscription ID
    const user = await db.collection('users').findOne({
      stripeSubscriptionId: subscription.id
    });
    
    if (!user) {
      console.warn('[webhook] User not found for subscription:', subscription.id);
      return;
    }
    
    // Update user to remove subscription access
    await db.collection('users').updateOne(
      { _id: user._id },
      {
        $set: {
          subscriptionStatus: 'canceled',
          unlimited: false,
          updatedAt: new Date()
        }
      }
    );
    
    // Update purchase record
    await db.collection('purchases').updateMany(
      { stripeSubscriptionId: subscription.id },
      {
        $set: {
          subscriptionStatus: 'canceled',
          updatedAt: new Date()
        }
      }
    );
    
    console.log('[webhook] Marked subscription as cancelled:', subscription.id);
  } catch (error) {
    console.error('[webhook] Error handling subscription.deleted:', error);
    throw error;
  }
}
