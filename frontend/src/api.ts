import { createApi, fetchBaseQuery, type BaseQueryFn, type FetchArgs, type FetchBaseQueryError } from '@reduxjs/toolkit/query/react';
import { signedOut } from './features/auth/authSlice';
import type { Order, Paged, Product, User } from './types';

interface AuthResponse {
  token: string;
  user: User;
}
export interface ProductInput {
  sku: string;
  name: string;
  description: string;
  priceCents: number;
  stock: number;
}

const rawBase = fetchBaseQuery({
  baseUrl: new URL('/api', window.location.origin).toString(), // absolute so it also works under jsdom/Node fetch
  prepareHeaders: (headers, { getState }) => {
    const token = (getState() as { auth: { token: string | null } }).auth.token;
    if (token) headers.set('authorization', `Bearer ${token}`);
    return headers;
  },
});

// Sign the user out whenever the API says the token is no longer valid.
const baseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (args, api, extra) => {
  const result = await rawBase(args, api, extra);
  const isAuthEndpoint = typeof args !== 'string' && args.url.startsWith('/auth/login');
  if (result.error?.status === 401 && !isAuthEndpoint) api.dispatch(signedOut());
  return result;
};

export const api = createApi({
  reducerPath: 'api',
  baseQuery,
  tagTypes: ['Product', 'Order'],
  endpoints: (b) => ({
    login: b.mutation<AuthResponse, { email: string; password: string }>({
      query: (body) => ({ url: '/auth/login', method: 'POST', body }),
    }),
    register: b.mutation<AuthResponse, { email: string; name: string; password: string }>({
      query: (body) => ({ url: '/auth/register', method: 'POST', body }),
    }),
    products: b.query<Paged<Product>, { search: string; page: number }>({
      query: ({ search, page }) => ({ url: '/inventory/products', params: { search: search || undefined, page, pageSize: 12 } }),
      providesTags: ['Product'],
    }),
    saveProduct: b.mutation<Product, { id?: string; data: Partial<ProductInput> }>({
      query: ({ id, data }) => ({ url: id ? `/inventory/products/${id}` : '/inventory/products', method: id ? 'PATCH' : 'POST', body: data }),
      invalidatesTags: ['Product'],
    }),
    deleteProduct: b.mutation<void, string>({
      query: (id) => ({ url: `/inventory/products/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Product'],
    }),
    orders: b.query<Paged<Order>, { page: number }>({
      query: ({ page }) => ({ url: '/orders', params: { page, pageSize: 10 } }),
      providesTags: ['Order'],
    }),
    createOrder: b.mutation<Order, { items: { productId: string; quantity: number }[] }>({
      query: (body) => ({ url: '/orders', method: 'POST', body }),
      invalidatesTags: ['Order', 'Product'],
    }),
    createCheckout: b.mutation<{ url: string }, string>({
      query: (orderId) => ({ url: '/payments/checkout', method: 'POST', body: { orderId } }),
    }),
    cancelOrder: b.mutation<Order, string>({
      query: (id) => ({ url: `/orders/${id}/cancel`, method: 'POST' }),
      invalidatesTags: ['Order', 'Product'],
    }),
  }),
});

export const {
  useLoginMutation, useRegisterMutation, useProductsQuery, useSaveProductMutation,
  useDeleteProductMutation, useOrdersQuery, useCreateOrderMutation, useCreateCheckoutMutation, useCancelOrderMutation,
} = api;

/** Pull a human-readable message out of an RTK Query error. */
export function errorMessage(err: unknown): string {
  const e = err as { status?: number | string; data?: { error?: string; details?: unknown } };
  if (e?.status === 'FETCH_ERROR') return 'Cannot reach the server. Please try again.';
  const base = e?.data?.error ?? 'Something went wrong.';
  const d = e?.data?.details;
  if (Array.isArray(d) && d.length) return `${base}: some items are out of stock or no longer exist.`;
  return base;
}
