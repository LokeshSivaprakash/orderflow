import { useEffect, useRef, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { signedOut } from '../features/auth/authSlice';
import { cleared, selectCount } from '../features/cart/cartSlice';
import { useAppDispatch, useAppSelector } from '../hooks';

export default function Layout({ children }: { children: ReactNode }) {
  const user = useAppSelector((s) => s.auth.user);
  const count = useAppSelector(selectCount);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  // Move focus to <main> on navigation so keyboard / screen-reader users start at the new content.
  useEffect(() => {
    mainRef.current?.focus({ preventScroll: false });
  }, [pathname]);

  function logout() {
    dispatch(signedOut());
    dispatch(cleared());
    dispatch(api.util.resetApiState());
    navigate('/login');
  }

  return (
    <>
      <a className="skip-link" href="#main">Skip to main content</a>
      <header className="site-header">
        <NavLink to="/" className="brand">OrderFlow</NavLink>
        {user && (
          <nav aria-label="Main">
            <ul>
              <li><NavLink to="/" end>Products</NavLink></li>
              <li>
                <NavLink to="/cart">
                  Cart <span className="badge" aria-label={`${count} items in cart`}>{count}</span>
                </NavLink>
              </li>
              <li><NavLink to="/orders">Orders</NavLink></li>
              {user.role === 'admin' && <li><NavLink to="/admin/products">Manage products</NavLink></li>}
            </ul>
          </nav>
        )}
        {user && (
          <div className="user-box">
            <span className="muted">{user.name}</span>
            <button type="button" className="btn btn-secondary" onClick={logout}>Sign out</button>
          </div>
        )}
      </header>
      <main id="main" ref={mainRef} tabIndex={-1}>{children}</main>
    </>
  );
}
