import { useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { errorMessage, useCancelOrderMutation, useCreateCheckoutMutation, useOrdersQuery } from '../api';
import Alert from '../components/Alert';
import Pagination from '../components/Pagination';
import { formatCents, formatDate } from '../format';
import { useTitle } from '../hooks';
import { redirectTo } from '../redirect';
import type { Order } from '../types';

const STATUS: Record<Order['status'], { label: string; cls: string }> = {
  PENDING_PAYMENT: { label: 'Awaiting payment', cls: 'pill-warn' },
  PAID: { label: 'Paid', cls: 'pill-on' },
  CANCELLED: { label: 'Cancelled', cls: 'pill-off' },
};

export default function OrdersPage() {
  useTitle('Orders');
  const [page, setPage] = useState(1);
  const [params] = useSearchParams();
  const payment = params.get('payment'); // set by the payment provider's redirect back to us
  const paymentFailed = (useLocation().state as { paymentFailed?: boolean } | null)?.paymentFailed;

  // The webhook may arrive a moment after the browser returns, so poll briefly until the order flips to PAID.
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (payment !== 'success') return;
    const t = setTimeout(() => setGaveUp(true), 30_000);
    return () => clearTimeout(t);
  }, [payment]);

  const [polling, setPolling] = useState(payment === 'success');
  const { data, isFetching, isError, error } = useOrdersQuery({ page }, { pollingInterval: polling && !gaveUp ? 2000 : 0 });
  const hasPending = data?.items.some((o) => o.status === 'PENDING_PAYMENT') ?? false;
  useEffect(() => {
    if (data && !hasPending) setPolling(false);
  }, [data, hasPending]);

  const [cancel, cancelState] = useCancelOrderMutation();
  const [createCheckout, checkoutState] = useCreateCheckoutMutation();

  async function pay(orderId: string) {
    try {
      const { url } = await createCheckout(orderId).unwrap();
      redirectTo(url);
    } catch {
      /* rendered below */
    }
  }

  return (
    <section aria-labelledby="orders-heading">
      <h1 id="orders-heading">Orders</h1>
      {payment === 'success' && hasPending && !gaveUp && <Alert kind="success">Payment received - confirming your order…</Alert>}
      {payment === 'success' && !hasPending && data && <Alert kind="success">Payment successful. Thank you!</Alert>}
      {payment === 'success' && hasPending && gaveUp && <Alert>Your payment is taking longer than expected to confirm. Refresh this page in a moment.</Alert>}
      {payment === 'cancelled' && <Alert>Payment was cancelled. Your items are held for about 30 minutes - you can pay below.</Alert>}
      {paymentFailed && <Alert>We could not open the payment page. Your order is saved - try "Pay now" below.</Alert>}
      {isError && <Alert>{errorMessage(error)}</Alert>}
      {cancelState.isError && <Alert>{errorMessage(cancelState.error)}</Alert>}
      {checkoutState.isError && <Alert>{errorMessage(checkoutState.error)}</Alert>}
      {isFetching && !data && <p role="status">Loading orders…</p>}
      {data && data.items.length === 0 && <p>No orders yet.</p>}
      <ul className="stack">
        {data?.items.map((o) => (
          <li key={o.id} className="card">
            <div className="row">
              <h2>Order {o.id.slice(0, 8)}</h2>
              <span className={`pill ${STATUS[o.status].cls}`}>{STATUS[o.status].label}</span>
            </div>
            <p className="muted"><time dateTime={o.createdAt}>{formatDate(o.createdAt)}</time> · {o.userEmail}</p>
            <ul>
              {o.items.map((i) => (
                <li key={i.productId}>{i.quantity} × {i.name} @ {formatCents(i.unitPriceCents)}</li>
              ))}
            </ul>
            <p><strong>Total {formatCents(o.totalCents)}</strong></p>
            {o.status === 'PENDING_PAYMENT' && (
              <>
                <p className="muted">Complete payment within about 30 minutes or the order is released.</p>
                <div className="row">
                  <button type="button" className="btn" disabled={checkoutState.isLoading} onClick={() => pay(o.id)} aria-label={`Pay for order ${o.id.slice(0, 8)}`}>
                    {checkoutState.isLoading ? 'Opening payment…' : 'Pay now'}
                  </button>
                  <button type="button" className="btn btn-secondary" disabled={cancelState.isLoading} onClick={() => cancel(o.id)} aria-label={`Cancel order ${o.id.slice(0, 8)}`}>
                    Cancel order
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
    </section>
  );
}
