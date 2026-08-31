// server/routes/__tests__/webhook.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock Stripe
const mockConstructEvent = vi.fn();
vi.mock('stripe', () => {
  return {
    default: class StripeMock {
      constructor() {}
      webhooks = {
        constructEvent: mockConstructEvent
      };
    }
  };
});

// Mock the checkout service
const mockHandleCheckoutCompleted = vi.fn();
vi.mock('../../services/checkoutCompleted.js', () => ({
  handleCheckoutCompleted: mockHandleCheckoutCompleted
}));

const mockHandleChargeRefunded = vi.fn();
vi.mock('../../services/refund/handleChargeRefunded.js', () => ({
  handleChargeRefunded: mockHandleChargeRefunded
}));

function buildApp() {
  const app = express();
  
  // Mount webhook route exactly like in server.js
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const handler = (await import('../webhook.js')).default;
    return handler(req, res);
  });
  
  return app;
}

describe('Stripe webhook (offline)', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
    
    // Default mock behavior
    mockConstructEvent.mockImplementation(() => ({
      id: 'evt_test_123',
      type: 'checkout.session.completed',
      data: { 
        object: {
          id: 'cs_test_123',
          customer: 'cus_test_123',
          customer_email: 'test@example.com',
          payment_intent: 'pi_test_123',
          metadata: {
            userId: '656565656565656565656565',
            stationID: '123',
            stationTitle: 'Test Station',
            country: 'usa',
            includeMoon: 'false',
            unlimited: 'false'
          }
        } 
      }
    }));
    
    mockHandleCheckoutCompleted.mockImplementation(async () => {
      console.log('[test] Mock handleCheckoutCompleted called');
      return true;
    });

    mockHandleChargeRefunded.mockResolvedValue(undefined);
  });

  it('returns 200 for checkout.session.completed', async () => {
    const payload = Buffer.from(JSON.stringify({ any: 'payload' }));
    
    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('stripe-signature', 't.sig.placeholder')
      .set('content-type', 'application/json')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  it('calls handleCheckoutCompleted for checkout.session.completed events', async () => {
    const payload = Buffer.from(JSON.stringify({ any: 'payload' }));
    
    await request(app)
      .post('/api/stripe/webhook')
      .set('stripe-signature', 't.sig.placeholder')
      .set('content-type', 'application/json')
      .send(payload);

    expect(mockHandleCheckoutCompleted).toHaveBeenCalledTimes(1);
    expect(mockHandleCheckoutCompleted).toHaveBeenCalledWith({
      id: 'cs_test_123',
      customer: 'cus_test_123',
      customer_email: 'test@example.com',
      payment_intent: 'pi_test_123',
      metadata: {
        userId: '656565656565656565656565',
        stationID: '123',
        stationTitle: 'Test Station',
        country: 'usa',
        includeMoon: 'false',
        unlimited: 'false'
      }
    });
  });

  it('handles signature verification failure', async () => {
    // Mock signature verification to throw
    mockConstructEvent.mockImplementationOnce(() => {
      throw new Error('Invalid signature');
    });

    const payload = Buffer.from(JSON.stringify({ any: 'payload' }));
    
    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('stripe-signature', 'invalid.signature')
      .set('content-type', 'application/json')
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.text).toContain('Webhook Error: Invalid signature');
  });

  it('handles processing errors gracefully', async () => {
    // Mock service to throw error
    mockHandleCheckoutCompleted.mockImplementationOnce(() => {
      throw new Error('Database connection failed');
    });

    const payload = Buffer.from(JSON.stringify({ any: 'payload' }));
    
    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('stripe-signature', 't.sig.placeholder')
      .set('content-type', 'application/json')
      .send(payload);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Webhook processing failed' });
  });

  it('calls handleChargeRefunded for charge.refunded events', async () => {
    mockConstructEvent.mockImplementationOnce(() => ({
      id: 'evt_refund_1',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_test_1',
          amount: 1000,
          amount_refunded: 1000,
          currency: 'usd'
        }
      }
    }));

    const payload = Buffer.from(JSON.stringify({ any: 'payload' }));

    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('stripe-signature', 't.sig.placeholder')
      .set('content-type', 'application/json')
      .send(payload);

    expect(res.status).toBe(200);
    expect(mockHandleChargeRefunded).toHaveBeenCalledTimes(1);
    expect(mockHandleChargeRefunded).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'evt_refund_1',
        type: 'charge.refunded',
        data: expect.objectContaining({
          object: expect.objectContaining({ id: 'ch_test_1' })
        })
      })
    );
  });

  it('ignores non-checkout events', async () => {
    // Mock different event type
    mockConstructEvent.mockImplementationOnce(() => ({
      id: 'evt_test_456',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test_456' } }
    }));

    const payload = Buffer.from(JSON.stringify({ any: 'payload' }));
    
    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('stripe-signature', 't.sig.placeholder')
      .set('content-type', 'application/json')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(mockHandleCheckoutCompleted).not.toHaveBeenCalled();
  });
});
