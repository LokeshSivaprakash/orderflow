export interface OrderForPayment {
  id: string;
  items: { name: string; unitPriceCents: number; quantity: number }[];
}

export interface CheckoutSession {
  id: string;
  url: string;
}

/** Provider-neutral webhook event, already signature-verified. */
export type PaymentEvent =
  | { id: string; type: 'paid'; sessionId: string; orderId: string; paymentIntentId: string | null }
  | { id: string; type: 'expired'; sessionId: string; orderId: string }
  | { id: string; type: 'ignored' };

export interface PaymentProvider {
  readonly name: 'stripe';
  createCheckoutSession(input: { order: OrderForPayment; successUrl: string; cancelUrl: string; attempt: number }): Promise<CheckoutSession>;
  /** Throws if the signature is invalid. */
  parseWebhook(rawBody: Buffer, signature: string | undefined): PaymentEvent;
  refund(paymentIntentId: string, idempotencyKey: string): Promise<void>;
}
