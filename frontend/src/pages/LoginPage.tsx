import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { errorMessage, useLoginMutation, useRegisterMutation } from '../api';
import Alert from '../components/Alert';
import { signedIn } from '../features/auth/authSlice';
import { useAppDispatch, useAppSelector, useTitle } from '../hooks';

export default function LoginPage() {
  useTitle('Sign in');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [login, loginState] = useLoginMutation();
  const [register, registerState] = useRegisterMutation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const user = useAppSelector((s) => s.auth.user);
  if (user) return <Navigate to={from} replace />;

  const state = mode === 'login' ? loginState : registerState;

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const res = mode === 'login' ? await login({ email, password }).unwrap() : await register({ email, name, password }).unwrap();
      dispatch(signedIn(res));
      navigate(from, { replace: true });
    } catch {
      /* error is rendered from mutation state */
    }
  }

  return (
    <section className="card narrow" aria-labelledby="login-heading">
      <h1 id="login-heading">{mode === 'login' ? 'Sign in' : 'Create account'}</h1>
      <form onSubmit={submit} noValidate={false}>
        {mode === 'register' && (
          <div className="field">
            <label htmlFor="name">Full name</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={100} />
          </div>
        )}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'register' ? 8 : undefined}
            aria-describedby={mode === 'register' ? 'pw-hint' : undefined}
          />
          {mode === 'register' && <small id="pw-hint" className="muted">At least 8 characters.</small>}
        </div>
        {state.isError && <Alert>{errorMessage(state.error)}</Alert>}
        <button type="submit" className="btn" disabled={state.isLoading}>
          {state.isLoading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>
      <p className="muted">
        {mode === 'login' ? 'New here?' : 'Already have an account?'}{' '}
        <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Create an account' : 'Sign in'}
        </button>
      </p>
    </section>
  );
}
