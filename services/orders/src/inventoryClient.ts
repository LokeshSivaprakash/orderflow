import { HttpError } from './lib/http';

export interface LineRequest {
  productId: string;
  quantity: number;
}
export interface ReservedLine extends LineRequest {
  sku: string;
  name: string;
  unitPriceCents: number;
}

/** Port to the inventory microservice. Swappable in tests; real impl is REST + timeout. */
export interface InventoryClient {
  reserve(items: LineRequest[]): Promise<ReservedLine[]>;
  release(items: LineRequest[]): Promise<void>;
}

export function httpInventoryClient(baseUrl: string, internalKey: string, timeoutMs = 5000): InventoryClient {
  async function call(path: string, items: LineRequest[]) {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/inventory/internal/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalKey },
        body: JSON.stringify({ items }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new HttpError(503, 'Inventory service unavailable');
    }
    return res;
  }
  return {
    async reserve(items) {
      const res = await call('reserve', items);
      const body = (await res.json().catch(() => ({}))) as { items?: ReservedLine[]; details?: unknown; error?: string };
      if (res.status === 409) throw new HttpError(409, 'Some items are unavailable', body.details);
      if (!res.ok || !body.items) throw new HttpError(502, 'Inventory service error');
      return body.items;
    },
    async release(items) {
      const res = await call('release', items);
      if (!res.ok) throw new HttpError(502, 'Failed to release stock');
    },
  };
}
