import { memo, useState } from 'react';
import { errorMessage, useProductsQuery } from '../api';
import Alert from '../components/Alert';
import Pagination from '../components/Pagination';
import { added } from '../features/cart/cartSlice';
import { formatCents } from '../format';
import { useAppDispatch, useAppSelector, useDebounced, useTitle } from '../hooks';
import type { Product } from '../types';

const ProductCard = memo(function ProductCard({ product, inCart, onAdd }: { product: Product; inCart: number; onAdd: (p: Product) => void }) {
  const soldOut = product.stock === 0;
  const atMax = inCart >= product.stock;
  return (
    <li className="card product">
      <h2>{product.name}</h2>
      <p className="muted">SKU {product.sku}</p>
      <p>{product.description}</p>
      <p className="price">{formatCents(product.priceCents)}</p>
      <p className={soldOut ? 'stock out' : product.stock < 5 ? 'stock low' : 'stock'}>
        {soldOut ? 'Out of stock' : `${product.stock} in stock`}
      </p>
      <button type="button" className="btn" disabled={soldOut || atMax} onClick={() => onAdd(product)} aria-label={`Add ${product.name} to cart`}>
        {atMax && !soldOut ? 'Max in cart' : 'Add to cart'}
      </button>
    </li>
  );
});

export default function ProductsPage() {
  useTitle('Products');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const { data, isFetching, isError, error } = useProductsQuery({ search: debounced, page });
  const dispatch = useAppDispatch();
  const lines = useAppSelector((s) => s.cart.lines);

  return (
    <section aria-labelledby="products-heading">
      <h1 id="products-heading">Products</h1>
      <div className="field search">
        <label htmlFor="search">Search by name or SKU</label>
        <input id="search" type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>
      {isError && <Alert>{errorMessage(error)}</Alert>}
      <p className="muted" role="status" aria-live="polite">
        {isFetching ? 'Loading products…' : data ? `${data.total} product${data.total === 1 ? '' : 's'} found` : ''}
      </p>
      <ul className="grid" aria-busy={isFetching}>
        {data?.items.map((p) => (
          <ProductCard key={p.id} product={p} inCart={lines[p.id]?.quantity ?? 0} onAdd={(prod) => dispatch(added(prod))} />
        ))}
      </ul>
      {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
    </section>
  );
}
