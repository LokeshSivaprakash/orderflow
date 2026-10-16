import reducer, { added, cleared, quantitySet, removed, selectCount, selectTotalCents } from '../features/cart/cartSlice';
import type { Product } from '../types';

const p = (over: Partial<Product> = {}): Product => ({ id: 'p1', sku: 'S1', name: 'Keyboard', description: '', priceCents: 5000, stock: 3, ...over });
const root = (cart: ReturnType<typeof reducer>) => ({ cart });

describe('cart slice', () => {
  it('adds products and caps quantity at available stock', () => {
    let s = reducer(undefined, added(p()));
    for (let i = 0; i < 10; i++) s = reducer(s, added(p()));
    expect(s.lines.p1.quantity).toBe(3);
  });

  it('does not add out-of-stock products', () => {
    expect(reducer(undefined, added(p({ stock: 0 }))).lines).toEqual({});
  });

  it('computes totals and counts with memoised selectors', () => {
    let s = reducer(undefined, added(p()));
    s = reducer(s, added(p({ id: 'p2', priceCents: 1000, stock: 9 })));
    s = reducer(s, quantitySet({ productId: 'p2', quantity: 4 }));
    expect(selectCount(root(s))).toBe(5);
    expect(selectTotalCents(root(s))).toBe(5000 + 4000);
  });

  it('removes a line when quantity set to 0, and supports remove/clear', () => {
    let s = reducer(undefined, added(p()));
    s = reducer(s, quantitySet({ productId: 'p1', quantity: 0 }));
    expect(s.lines).toEqual({});
    s = reducer(reducer(s, added(p())), removed('p1'));
    expect(s.lines).toEqual({});
    s = reducer(reducer(s, added(p())), cleared());
    expect(s.lines).toEqual({});
  });
});
