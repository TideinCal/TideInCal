import Stripe from 'stripe';
import { getDatabase } from '../../db/index.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * True when the charge is fully refunded (Stripe uses cumulative amount_refunded vs amount).
 */
export function isChargeFullyRefunded(charge) {
  const amount = charge.amount;
  const refunded = charge.amount_refunded ?? 0;
  return typeof amount === 'number' && amount > 0 && refunded >= amount;
}

/**
 * True when there is a partial refund but not full.
 */
export function isChargePartiallyRefunded(charge) {
  const amount = charge.amount;
  const refunded = charge.amount_refunded ?? 0;
  return refunded > 0 && typeof amount === 'number' && amount > 0 && refunded < amount;
}

/**
 * Idempotent processing for Stripe charge.refunded events.
 * Full refund: sets fullyRefundedAt on purchase(s) and revokes Pro for subscription refunds.
 * Partial: sets lastRefundPartialAt only (no access change).
 */
export async function handleChargeRefunded(event) {
  const charge = event.data.object;
  const eventId = event.id;
  const db = getDatabase();
  const { ObjectId } = await import('mongodb');

  try {
    await db.collection('webhook_events').insertOne({
      eventId,
      type: 'charge.refunded',
      chargeId: charge.id,
      createdAt: new Date(),
    });
  } catch (e) {
    if (e.code === 11000) {
      console.log('[refund] duplicate webhook event, skipping:', eventId);
      return;
    }
    throw e;
  }

  try {
    const now = new Date();
    const full = isChargeFullyRefunded(charge);
    const partial = isChargePartiallyRefunded(charge);

    if (!full && !partial) {
      console.log('[refund] no refund amount on charge, skipping:', charge.id);
      return;
    }

    // Subscription invoice charge: invoice link takes precedence over payment_intent-only matching.
    if (charge.invoice) {
      const invoiceId =
        typeof charge.invoice === 'string' ? charge.invoice : charge.invoice?.id;
      if (!invoiceId) {
        console.warn('[refund] charge has invoice but no id');
        return;
      }

      const invoice = await stripe.invoices.retrieve(invoiceId);
      const subscriptionId =
        typeof invoice.subscription === 'string'
          ? invoice.subscription
          : invoice.subscription?.id || null;

      if (!subscriptionId) {
        console.warn('[refund] invoice has no subscription:', invoiceId);
        return;
      }

      const purchase = await db.collection('purchases').findOne(
        { product: 'subscription', stripeSubscriptionId: subscriptionId },
        { sort: { createdAt: -1 } }
      );

      if (!purchase) {
        console.warn('[refund] no subscription purchase for subscription:', subscriptionId);
        return;
      }

      if (full) {
        await db.collection('purchases').updateOne(
          { _id: purchase._id },
          { $set: { fullyRefundedAt: now, updatedAt: now } }
        );
        await db.collection('users').updateMany(
          { stripeSubscriptionId: subscriptionId },
          {
            $set: {
              subscriptionStatus: 'canceled',
              unlimited: false,
              updatedAt: now,
            },
          }
        );
        console.log('[refund] full subscription refund processed for subscription:', subscriptionId);
      } else if (partial) {
        await db.collection('purchases').updateOne(
          { _id: purchase._id },
          { $set: { lastRefundPartialAt: now, updatedAt: now } }
        );
        console.log('[refund] partial subscription refund recorded for subscription:', subscriptionId);
      }
      return;
    }

    // One-time / PaymentIntent charges (no invoice on charge)
    const piRaw = charge.payment_intent;
    const paymentIntentId =
      typeof piRaw === 'string' ? piRaw : piRaw?.id || null;
    if (!paymentIntentId) {
      console.warn('[refund] charge has no invoice and no payment_intent:', charge.id);
      return;
    }

    const purchase = await db.collection('purchases').findOne({
      stripePaymentIntentId: paymentIntentId,
    });

    if (!purchase) {
      console.warn('[refund] no purchase for payment_intent:', paymentIntentId);
      return;
    }

    if (full) {
      await db.collection('purchases').updateOne(
        { _id: purchase._id },
        { $set: { fullyRefundedAt: now, updatedAt: now } }
      );
      console.log('[refund] full one-time refund for purchase:', purchase._id.toString());
    } else if (partial) {
      await db.collection('purchases').updateOne(
        { _id: purchase._id },
        { $set: { lastRefundPartialAt: now, updatedAt: now } }
      );
      console.log('[refund] partial one-time refund recorded for purchase:', purchase._id.toString());
    }
  } catch (err) {
    await db.collection('webhook_events').deleteOne({ eventId });
    throw err;
  }
}
