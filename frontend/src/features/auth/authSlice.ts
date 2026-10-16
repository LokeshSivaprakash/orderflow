import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { User } from '../../types';

interface AuthState {
  token: string | null;
  user: User | null;
}

const KEY = 'orderflow.auth';
function load(): AuthState {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as AuthState;
  } catch {
    /* storage unavailable or corrupt: start signed out */
  }
  return { token: null, user: null };
}
export function persist(state: AuthState) {
  try {
    if (state.token) sessionStorage.setItem(KEY, JSON.stringify(state));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

const slice = createSlice({
  name: 'auth',
  initialState: load(),
  reducers: {
    signedIn(_s, a: PayloadAction<{ token: string; user: User }>) {
      return a.payload;
    },
    signedOut() {
      return { token: null, user: null };
    },
  },
});
export const { signedIn, signedOut } = slice.actions;
export default slice.reducer;
