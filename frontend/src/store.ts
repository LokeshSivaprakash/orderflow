import { configureStore } from '@reduxjs/toolkit';
import { api } from './api';
import authReducer, { persist } from './features/auth/authSlice';
import cartReducer from './features/cart/cartSlice';

export function makeStore() {
  const store = configureStore({
    reducer: { auth: authReducer, cart: cartReducer, [api.reducerPath]: api.reducer },
    middleware: (gdm) => gdm().concat(api.middleware),
  });
  store.subscribe(() => persist(store.getState().auth));
  return store;
}
export const store = makeStore();
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
