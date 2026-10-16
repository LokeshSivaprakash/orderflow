import { useState, type FormEvent } from 'react';
import { errorMessage, useDeleteProductMutation, useProductsQuery, useSaveProductMutation } from '../api';
import Alert from '../components/Alert';
import Pagination from '../components/Pagination';
import { formatCents } from '../format';
import { useTitle } from '../hooks';

const empty = { sku: '', name: '', description: '', price: '', stock: '0' };

export default function AdminProductsPage() {
  useTitle('Manage products');
  const [page, setPage] = useState(1);
  const { data, isError, error } = useProductsQuery({ search: '', page });
  const [save, saveState] = useSaveProductMutation();
  const [remove, removeState] = useDeleteProductMutation();
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<string | undefined>();
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await save({
        id: editing,
        data: { sku: form.sku, name: form.name, description: form.description, priceCents: Math.round(Number(form.price) * 100), stock: Number(form.stock) },
      }).unwrap();
      setForm(empty);
      setEditing(undefined);
    } catch {
      /* rendered below */
    }
  }

  return (
    <section aria-labelledby="admin-heading">
      <h1 id="admin-heading">Manage products</h1>
      <form className="card" onSubmit={submit} aria-label={editing ? 'Edit product' : 'Add product'}>
        <h2>{editing ? 'Edit product' : 'Add product'}</h2>
        <div className="form-grid">
          <div className="field"><label htmlFor="sku">SKU</label><input id="sku" value={form.sku} onChange={set('sku')} required maxLength={64} /></div>
          <div className="field"><label htmlFor="pname">Name</label><input id="pname" value={form.name} onChange={set('name')} required maxLength={200} /></div>
          <div className="field"><label htmlFor="price">Price (USD)</label><input id="price" type="number" min="0" step="0.01" value={form.price} onChange={set('price')} required /></div>
          <div className="field"><label htmlFor="stock">Stock</label><input id="stock" type="number" min="0" step="1" value={form.stock} onChange={set('stock')} required /></div>
        </div>
        <div className="field"><label htmlFor="desc">Description</label><textarea id="desc" value={form.description} onChange={set('description')} maxLength={2000} rows={3} /></div>
        {saveState.isError && <Alert>{errorMessage(saveState.error)}</Alert>}
        <div className="row">
          <button type="submit" className="btn" disabled={saveState.isLoading}>{editing ? 'Save changes' : 'Add product'}</button>
          {editing && <button type="button" className="btn btn-secondary" onClick={() => { setEditing(undefined); setForm(empty); }}>Cancel edit</button>}
        </div>
      </form>

      {isError && <Alert>{errorMessage(error)}</Alert>}
      {removeState.isError && <Alert>{errorMessage(removeState.error)}</Alert>}
      <div className="table-wrap">
        <table>
          <caption className="sr-only">All products</caption>
          <thead><tr><th scope="col">SKU</th><th scope="col">Name</th><th scope="col">Price</th><th scope="col">Stock</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {data?.items.map((p) => (
              <tr key={p.id}>
                <th scope="row">{p.sku}</th>
                <td>{p.name}</td>
                <td>{formatCents(p.priceCents)}</td>
                <td>{p.stock}</td>
                <td className="actions">
                  <button type="button" className="btn btn-secondary" aria-label={`Edit ${p.name}`}
                    onClick={() => { setEditing(p.id); setForm({ sku: p.sku, name: p.name, description: p.description, price: (p.priceCents / 100).toFixed(2), stock: String(p.stock) }); window.scrollTo({ top: 0 }); }}>Edit</button>
                  <button type="button" className="btn btn-danger" aria-label={`Delete ${p.name}`}
                    onClick={() => { if (window.confirm(`Delete ${p.name}?`)) remove(p.id); }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onChange={setPage} />}
    </section>
  );
}
