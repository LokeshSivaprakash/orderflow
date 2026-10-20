import { HttpError } from './lib/http';

export interface OrderSummary {
  id: string;
  userId: string;
  status: 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED';
  totalCents: number;
  items: { name: string; unitPriceCents: number; quantity: number }[];
}

/** Port to the orders microservice (internal API). */
export interface OrdersClient {
  getOrder(id: string): Promise<OrderSummary | null>;
  /** 'ok' if now PAID; 'cancelled' if the order was cancelled first (caller must refund). */
  markPaid(id: string): Promise<'ok' | 'cancelled'>;
  expire(id: string): Promise<void>;
}

export function httpOrdersClient(baseUrl: string, internalKey: string, timeoutMs = 5000): OrdersClient {
  async function call(path: string, method: 'GET' | 'POST') {
    try {
      return await fetch(`${baseUrl}/orders/internal/${path}`, {
        method,
        headers: { 'x-internal-key': internalKey },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new HttpError(503, 'Orders service unavailable');
    }
  }
  return {
    async getOrder(id) {
      const res = await call(id, 'GET');
      if (res.status === 404) return null;
      if (!res.ok) throw new HttpError(502, 'Orders service error');
      return (await res.json()) as OrderSummary;
    },
    async markPaid(id) {
      const res = await call(`${id}/paid`, 'POST');
      if (res.status === 409) return 'cancelled';
      if (!res.ok) throw new HttpError(502, 'Orders service error');
      return 'ok';
    },
    async expire(id) {
      const res = await call(`${id}/expire`, 'POST');
      if (!res.ok) throw new HttpError(502, 'Orders service error');
    },
  };
}
