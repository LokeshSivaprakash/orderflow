import { useEffect, useState } from 'react';
import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux';
import type { AppDispatch, RootState } from './store';

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

/** Debounce a fast-changing value (e.g. a search box) to avoid a request per keystroke. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Keep document.title meaningful for screen-reader users on route changes. */
export function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · OrderFlow`;
  }, [title]);
}
