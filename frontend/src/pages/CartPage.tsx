import { Link, useNavigate } from 'react-router-dom';
import { errorMessage, useCreateOrderMutation } from '../api';
import Alert from '../components/Alert';
import { cleared, quantitySet, removed, selectLines, selectTotalCents } from '../features/cart/cartSlice';
import { formatCents } from '../format';
import { useAppDispatch, useAppSelector, useTitle } from '../hooks';

export default function CartPage() {
  useTitle('Cart');
  const lines = useAppSelector(selectLines);
  const total = useAppSelector(selectTotalCents);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [createOrder, { isLoading, isError, error }] = useCreateOrderMutation();

  async function checkout() {
    try {
      await createOrder({ items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })) }).unwrap();
      dispatch(cleared());
      navigate('/orders', { state: { placed: true } });
    } catch {
      /* rendered below */
    }
  }

  if (!lines.length)
    return (
      <section>
        <h1>Your cart</h1>
        <p>Your cart is empty. <Link to="/">Browse products</Link>.</p>
      </section>
    );

  return (
    <section aria-labelledby="cart-heading">
      <h1 id="cart-heading">Your cart</h1>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Items in your cart</caption>
          <thead>
            <tr><th scope="col">Item</th><th scope="col">Price</th><th scope="col">Quantity</th><th scope="col">Subtotal</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.productId}>
                <th scope="row">{l.name}<br /><span className="muted">{l.sku}</span></th>
                <td>{formatCents(l.unitPriceCents)}</td>
                <td>
                  <label className="sr-only" htmlFor={`qty-${l.productId}`}>Quantity for {l.name}</label>
                  <input
                    id={`qty-${l.productId}`}
                    className="qty"
                    type="number"
                    min={1}
                    max={l.maxQuantity}
                    value={l.quantity}
                    onChange={(e) => dispatch(quantitySet({ productId: l.productId, quantity: Number(e.target.value) }))}
                  />
                </td>
                <td>{formatCents(l.unitPriceCents * l.quantity)}</td>
                <td><button type="button" className="btn btn-secondary" onClick={() => dispatch(removed(l.productId))} aria-label={`Remove ${l.name}`}>Remove</button></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><th scope="row" colSpan={3}>Total</th><td colSpan={2}><strong>{formatCents(total)}</strong></td></tr>
          </tfoot>
        </table>
      </div>
      {isError && <Alert>{errorMessage(error)}</Alert>}
      <button type="button" className="btn" onClick={checkout} disabled={isLoading}>{isLoading ? 'Placing order…' : 'Place order'}</button>
    </section>
  );
}
