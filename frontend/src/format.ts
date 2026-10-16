const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const formatCents = (cents: number) => money.format(cents / 100);
export const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
