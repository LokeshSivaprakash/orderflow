# OrderFlow - B2B Order & Inventory Platform

A full-stack, cloud-native web application: a React + TypeScript single-page app in front of four Node.js/TypeScript microservices (auth, inventory, orders, payments), each with its own PostgreSQL database, packaged with Docker, deployable to Kubernetes (EKS) on AWS, and built/tested/deployed by a GitLab CI/CD pipeline.

Staff browse a product catalogue, build a cart and place orders; the order service reserves stock through the inventory service (saga with compensation, no overselling) and the order waits for payment. Payment happens on **Stripe Checkout (test mode)**; a signed Stripe webhook then confirms the order. Unpaid orders can be cancelled or expire after ~30 minutes and the stock is released. Admins manage products.

## Run it locally

Payments use **real Stripe in test mode** (no real money, test cards only), so you need a free Stripe account and the Stripe CLI once.

### One-time Stripe setup

1. Create a free account at https://dashboard.stripe.com and make sure the **Test mode** toggle is on.
2. Copy your **secret test key** (`sk_test_...`) from Developers -> API keys.
3. Install the Stripe CLI (Windows: `winget install Stripe.StripeCli`; macOS: `brew install stripe/stripe-cli/stripe`) and run `stripe login`.
4. Start webhook forwarding and leave it running in its own terminal. It prints a signing secret (`whsec_...`):

   ```bash
   stripe listen --forward-to localhost:8080/api/payments/webhook
   ```

5. Copy `.env.example` to `.env` and fill in `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. `.env` is git-ignored; never commit keys. The payments service refuses to start with a live key (`sk_live_...`).

### Option A - Docker (everything)

```bash
docker compose up --build        # then open http://localhost:8080
# seed demo products (one time):
docker compose exec inventory node dist/seed.js
```

If you ran an earlier version of this stack, the Postgres volume predates the payments database. Either `docker compose down -v` (wipes data) or create it: `docker compose exec postgres createdb -U orderflow orderflow_payments`.

Admin login: `admin@orderflow.local` / `ChangeMe123!` (set via `ADMIN_PASSWORD`). Anyone can self-register as a normal `staff` user.

### Option B - local dev (hot reload)

```bash
# 1. Postgres with four databases
docker run -d --name of-pg -e POSTGRES_USER=orderflow -e POSTGRES_PASSWORD=orderflow -p 5432:5432 postgres:16-alpine
for d in auth inventory orders payments; do docker exec of-pg createdb -U orderflow orderflow_$d; done

# 2. Services (separate terminals) - migrations run automatically on start
cd services/auth      && npm i && ADMIN_EMAIL=admin@orderflow.local ADMIN_PASSWORD='ChangeMe123!' npm run dev   # :4001
cd services/inventory && npm i && npm run seed && npm run dev                                                    # :4002
cd services/orders    && npm i && npm run dev                                                                    # :4003
cd services/payments  && npm i && STRIPE_SECRET_KEY=sk_test_... STRIPE_WEBHOOK_SECRET=whsec_... npm run dev     # :4004

# 3. Frontend (Vite proxies /api/* like the nginx gateway does)
cd frontend && npm i && npm run dev                                                                              # :5173

# 4. In dev mode forward webhooks to the payments service (use the whsec_ it prints):
stripe listen --forward-to localhost:4004/payments/webhook
```

### Try a payment (test cards)

Place an order and press **Place order & pay**. On the Stripe page use `4242 4242 4242 4242`, any future expiry, any CVC, any postal code. Other useful cards: `4000 0000 0000 9995` (declined, insufficient funds) and `4000 0025 0000 3155` (requires 3-D Secure authentication). In the `stripe listen` terminal you will see `checkout.session.completed` delivered with `[200]`, and the order flips from "Awaiting payment" to "Paid". See https://docs.stripe.com/testing for more cards.

## Tests

```bash
# services need a Postgres reachable via TEST_DATABASE_URL (defaults to postgres:postgres@localhost/orderflow_<svc>_test)
cd services/<auth|inventory|orders|payments> && npm test
cd frontend && npm test
```

What was verified when this repo was assembled: 43 backend tests (including a 25-way concurrent-reservation race, the order-saga compensation path, Stripe webhook signature verification, idempotent webhook redelivery, refund-on-race and expiry handling) and 11 frontend tests pass; all packages type-check; the frontend production build succeeds; and a manual end-to-end run across the real services worked against PostgreSQL 16 (register -> list -> order as PENDING_PAYMENT -> signed webhook -> PAID -> expired webhook -> stock restored -> RBAC/internal-key 403s). **Not verified in the authoring sandbox:** talking to the real Stripe API and hosted Checkout page (no Stripe keys/network there; the checkout-session call and webhook were exercised through test doubles and locally signed events), the Docker images and `docker compose up` end to end, Kubernetes manifests on a cluster, the GitLab pipeline, and `terraform plan/apply`. Expect a first-run debugging pass on those.

## Where each job requirement is demonstrated

| Requirement | Where |
|---|---|
| React, TypeScript, HTML5/CSS3 | `frontend/` (React 18, strict TS, semantic HTML, hand-written responsive CSS with dark mode) |
| Node.js backend | `services/*` (Express + TypeScript, zod validation, `pg`) |
| Responsive design | CSS grid/flex, `auto-fill` product grid, scrollable tables on small screens (`styles.css`) |
| Accessibility | Skip link, landmarks, focus moved to `<main>` on route change, labelled controls, `aria-live` status, `role=alert` errors, table captions/scopes, visible focus, reduced-motion & colour-scheme support |
| Performance | Route-level code splitting (`React.lazy`), debounced search, `memo`'d cards, memoised selectors, server-side pagination, hashed long-cache assets + gzip in nginx, DB indexes |
| Component architecture | `components/` (Layout, Pagination, Alert, RequireAuth) + `pages/` |
| State management | Redux Toolkit slices (auth, cart) + RTK Query for server state, caching and invalidation |
| REST APIs & integration | Resource-oriented routes, status codes, pagination, validation errors; order -> inventory service-to-service REST with timeout |
| Microservices | 4 independently deployable services, database-per-service, API gateway (nginx), shared-secret internal endpoints blocked at the gateway |
| Payments / third-party API integration | Stripe Checkout (hosted page, no card data on our servers), HMAC-verified webhooks, idempotent handlers, refund when a payment races a cancellation, provider abstraction (`PaymentProvider`) so it is unit-testable |
| PostgreSQL | SQL migrations, constraints, indexes, row locking (`SELECT ... FOR UPDATE`), transactions |
| Docker / Kubernetes | Multi-stage non-root Dockerfiles, `docker-compose.yml`, `deploy/k8s` (probes, resources, HPA, NetworkPolicies, securityContext, Kustomize) |
| AWS | `deploy/terraform`: VPC, ECR, EKS, RDS PostgreSQL, Secrets Manager; ALB ingress |
| GitLab CI/CD & DevOps | `.gitlab-ci.yml`: parallel test matrix with a Postgres service, audit, Kaniko image builds to ECR, OIDC (no stored AWS keys), auto staging deploy, manual production deploy |

See `docs/ARCHITECTURE.md` for the design and trade-offs, and `docs/RESUME_AND_INTERVIEW.md` for resume bullets and interview talking points.

## Repository layout

```
frontend/            React + TS SPA, nginx gateway config, Dockerfile
services/auth        Users, login, JWT
services/inventory   Catalogue, stock, atomic reserve/release
services/orders      Orders, cancel, saga orchestration, payment status
services/payments    Stripe Checkout sessions + signed webhooks
deploy/k8s           Kustomize manifests
deploy/terraform     AWS infrastructure
.gitlab-ci.yml       CI/CD
docker-compose.yml   Local full stack
```
