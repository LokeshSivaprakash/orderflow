import Stripe from 'stripe';
import { config } from './config';
import type { PaymentEvent, PaymentProvider } from './provider';

/**
 * Stripe Checkout (hosted page). Card details are entered on Stripe's domain and never touch our servers,
 * which keeps this app out of PCI scope beyond SAQ A.
 */
export function stripeProvider(secretKey = config.stripeSecretKey, webhookSecret = config.stripeWebhookSecret): PaymentProvider {
  const stripe = new Stripe(secretKey || 'sk_test_missing', { maxNetworkRetries: 2, timeout: 10_000 });

  return {
    name: 'stripe',

    async createCheckoutSession({ order, successUrl, cancelUrl, attempt }) {
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          line_items: order.items.map((i) => ({
            quantity: i.quantity,
            price_data: { currency: 'usd', unit_amount: i.unitPriceCents, product_data: { name: i.name } },
          })),
          client_reference_id: order.id,
          metadata: { orderId: order.id },
          payment_intent_data: { metadata: { orderId: order.id } },
          success_url: successUrl,
          cancel_url: cancelUrl,
          expires_at: Math.floor(Date.now() / 1000) + config.checkoutTtlMinutes * 60,
        },
        { idempotencyKey: `checkout-${order.id}-${attempt}` },
      );
      if (!session.url) throw new Error('Stripe did not return a checkout URL');
      return { id: session.id, url: session.url };
    },

    parseWebhook(rawBody, signature) {
      if (!signature) throw new Error('Missing Stripe-Signature header');
      // Verifies the HMAC and the timestamp tolerance (replay protection).
      const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      return normalise(event);
    },

    async refund(paymentIntentId, idempotencyKey) {
      await stripe.refunds.create({ payment_intent: paymentIntentId }, { idempotencyKey });
    },
  };
}

export function normalise(event: Stripe.Event): PaymentEvent {
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const s = event.data.object as Stripe.Checkout.Session;
    const orderId = s.metadata?.orderId ?? s.client_reference_id;
    // 'unpaid' means a delayed payment method that has not settled yet; wait for async_payment_succeeded.
    if (!orderId || s.payment_status === 'unpaid') return { id: event.id, type: 'ignored' };
    const pi = typeof s.payment_intent === 'string' ? s.payment_intent : (s.payment_intent?.id ?? null);
    return { id: event.id, type: 'paid', sessionId: s.id, orderId, paymentIntentId: pi };
  }
  if (event.type === 'checkout.session.expired') {
    const s = event.data.object as Stripe.Checkout.Session;
    const orderId = s.metadata?.orderId ?? s.client_reference_id;
    if (!orderId) return { id: event.id, type: 'ignored' };
    return { id: event.id, type: 'expired', sessionId: s.id, orderId };
  }
  return { id: event.id, type: 'ignored' };
}
