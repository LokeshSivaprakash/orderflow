import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { errorMessage, useCancelOrderMutation, useOrdersQuery } from '../api';
import Alert from '../components/Alert';
import Pagination from '../components/Pagination';
import { formatCents, formatDate } from '../format';
import { useTitle } from '../hooks';

export default function OrdersPage() {
  useTitle('Orders');
  const [page, setPage] = useState(1);
  const { data, isFetching, isError, error } = useOrdersQuery({ page });
  const [cancel, cancelState] = useCancelOrderMutation();
  const placed = (useLocation().state as { placed?: boolean } | null)?.placed;

  return (
    <section aria-labelledby="orders-heading">
      <h1 id="orders-heading">Orders</h1>
      {placed && <Alert kind="success">Order placed successfully.</Alert>}
      {isError && <Alert>{errorMessage(error)}</Alert>}
      {cancelState.isError && <Alert>{errorMessage(cancelState.error)}</Alert>}
      {isFetching && <p role="status">Loading orders…</p>}
      {data && data.items.length === 0 && <p>No orders yet.</p>}
      <ul className="stack">
        {data?.items.map((o) => (
          <li key={o.id} className="card">
            <div className="row">
              <h2>Order {o.id.slice(0, 8)}</h2>
              <span className={`pill ${o.status === 'CANCELLED' ? 'pill-off' : 'pill-on'}`}>{o.status === 'CANCELLED' ? 'Cancelled' : 'Confirmed'}</span>
            </div>
            <p className="muted"><time dateTime={o.createdAt}>{formatDate(o.createdAt)}</time> · {o.userEmail}</p>
            <ul>
              {o.items.map((i) => (
                <li key={i.productId}>{i.quantity} × {i.name} @ {formatCents(i.unitPriceCents)}</li>
              ))}
            </ul>
            <p><strong>Total {formatCents(o.totalCents)}</strong></p>
            {o.status === 'CONFIRMED' && (
              <button type="button" className="btn btn-secondary" disabled={cancelState.isLoading} onClick={() => cancel(o.id)} aria-label={`Cancel order ${o.id.slice(0, 8)}`}>
                Cancel order
              </button>
            )}
          </li>
        ))}
      </ul>
      {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
    </section>
  );
}
