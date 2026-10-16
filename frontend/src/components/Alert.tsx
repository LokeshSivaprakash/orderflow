import type { ReactNode } from 'react';

/** role=alert announces errors immediately; role=status is polite. */
export default function Alert({ kind = 'error', children }: { kind?: 'error' | 'success'; children: ReactNode }) {
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
