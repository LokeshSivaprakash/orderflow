import { createSelector, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Product } from '../../types';

export interface CartLine {
  productId: string;
  sku: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  maxQuantity: number;
}
interface CartState {
  lines: Record<string, CartLine>;
}

const slice = createSlice({
  name: 'cart',
  initialState: { lines: {} } as CartState,
  reducers: {
    added(state, a: PayloadAction<Product>) {
      const p = a.payload;
      const line = state.lines[p.id];
      if (line) line.quantity = Math.min(line.quantity + 1, p.stock);
      else if (p.stock > 0)
        state.lines[p.id] = { productId: p.id, sku: p.sku, name: p.name, unitPriceCents: p.priceCents, quantity: 1, maxQuantity: p.stock };
    },
    quantitySet(state, a: PayloadAction<{ productId: string; quantity: number }>) {
      const line = state.lines[a.payload.productId];
      if (!line) return;
      const q = Math.floor(a.payload.quantity);
      if (q <= 0) delete state.lines[line.productId];
      else line.quantity = Math.min(q, line.maxQuantity);
    },
    removed(state, a: PayloadAction<string>) {
      delete state.lines[a.payload];
    },
    cleared(state) {
      state.lines = {};
    },
  },
});
export const { added, quantitySet, removed, cleared } = slice.actions;
export default slice.reducer;

type Root = { cart: CartState };
export const selectLines = createSelector([(s: Root) => s.cart.lines], (l) => Object.values(l));
export const selectCount = createSelector([selectLines], (lines) => lines.reduce((n, l) => n + l.quantity, 0));
export const selectTotalCents = createSelector([selectLines], (lines) =>
  lines.reduce((n, l) => n + l.quantity * l.unitPriceCents, 0),
);
