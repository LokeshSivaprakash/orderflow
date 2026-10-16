import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../api';
import authReducer from '../features/auth/authSlice';
import cartReducer from '../features/cart/cartSlice';
import ProductsPage from '../pages/ProductsPage';

const products = {
  items: [
    { id: 'a', sku: 'KB-1', name: 'Keyboard', description: 'Mechanical', priceCents: 4999, stock: 2 },
    { id: 'b', sku: 'MS-1', name: 'Mouse', description: 'Wireless', priceCents: 1999, stock: 0 },
  ],
  page: 1, pageSize: 12, total: 2,
};

function renderPage() {
  const store = configureStore({
    reducer: { auth: authReducer, cart: cartReducer, [api.reducerPath]: api.reducer },
    middleware: (g) => g().concat(api.middleware),
  });
  render(<Provider store={store}><MemoryRouter><ProductsPage /></MemoryRouter></Provider>);
  return store;
}

describe('ProductsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(products), { status: 200, headers: { 'content-type': 'application/json' } })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders products with formatted prices and disables sold-out items', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Keyboard' })).toBeInTheDocument();
    expect(screen.getByText('$49.99')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Mouse to cart' })).toBeDisabled();
  });

  it('adds to cart and stops at stock limit', async () => {
    const store = renderPage();
    const btn = await screen.findByRole('button', { name: 'Add Keyboard to cart' });
    await userEvent.click(btn);
    await userEvent.click(btn);
    expect(store.getState().cart.lines.a.quantity).toBe(2);
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent('Max in cart');
  });

  it('exposes a labelled search field', async () => {
    renderPage();
    expect(await screen.findByLabelText('Search by name or SKU')).toBeInTheDocument();
  });
});
