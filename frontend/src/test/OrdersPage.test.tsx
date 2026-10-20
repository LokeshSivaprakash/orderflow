import { configureStore } from '@reduxjs/toolkit';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../api';
import authReducer from '../features/auth/authSlice';
import cartReducer from '../features/cart/cartSlice';
import OrdersPage from '../pages/OrdersPage';
import * as redirect from '../redirect';

const order = (id: string, status: string) => ({
  id, userEmail: 'a@x.com', status, totalCents: 9998, createdAt: '2026-10-01T10:00:00Z', paidAt: null,
  items: [{ productId: 'p', sku: 'S', name: 'Keyboard', unitPriceCents: 4999, quantity: 2 }],
});
const page = (items: unknown[]) => ({ items, page: 1, pageSize: 10, total: items.length });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function renderPage(url = '/orders') {
  const store = configureStore({
    reducer: { auth: authReducer, cart: cartReducer, [api.reducerPath]: api.reducer },
    middleware: (g) => g().concat(api.middleware),
  });
  render(<Provider store={store}><MemoryRouter initialEntries={[url]}><OrdersPage /></MemoryRouter></Provider>);
}

describe('OrdersPage payments', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('offers Pay now and Cancel only for orders awaiting payment', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(page([order('11111111-aaaa', 'PENDING_PAYMENT'), order('22222222-bbbb', 'PAID'), order('33333333-cccc', 'CANCELLED')]))));
    renderPage();
    expect(await screen.findByText('Awaiting payment')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Pay for order/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Cancel order/ })).toHaveLength(1);
  });

  it('Pay now requests a checkout session and redirects to the hosted page', async () => {
    const redirectSpy = vi.spyOn(redirect, 'redirectTo').mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (req: Request) =>
      req.url.endsWith('/payments/checkout') ? json({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' }, 201) : json(page([order('11111111-aaaa', 'PENDING_PAYMENT')])),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^Pay for order/ }));
    await waitFor(() => expect(redirectSpy).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_1'));
    const checkoutReq = fetchMock.mock.calls.map((c) => c[0] as Request).find((r) => r.url.endsWith('/payments/checkout'))!;
    expect(checkoutReq.method).toBe('POST');
    expect(await checkoutReq.clone().json()).toEqual({ orderId: '11111111-aaaa' });
  });

  it('shows a confirmation after returning from a successful payment', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(page([order('22222222-bbbb', 'PAID')]))));
    renderPage('/orders?payment=success');
    expect(await screen.findByText('Payment successful. Thank you!')).toBeInTheDocument();
  });

  it('tells the user their items are held after cancelling at the payment page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(page([order('11111111-aaaa', 'PENDING_PAYMENT')]))));
    renderPage('/orders?payment=cancelled');
    expect(await screen.findByText(/Payment was cancelled/)).toBeInTheDocument();
  });
});
