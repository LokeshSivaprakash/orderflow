export type Role = 'admin' | 'staff';
export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}
export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  priceCents: number;
  stock: number;
}
export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
export interface OrderItem {
  productId: string;
  sku: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
}
export interface Order {
  id: string;
  userEmail: string;
  status: 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED';
  totalCents: number;
  createdAt: string;
  paidAt: string | null;
  items: OrderItem[];
}
