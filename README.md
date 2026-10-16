# OrderFlow - B2B Order & Inventory Platform

A full-stack, cloud-native web application: a React + TypeScript single-page app in front of three Node.js/TypeScript microservices (auth, inventory, orders), each with its own PostgreSQL database, packaged with Docker, deployable to Kubernetes (EKS) on AWS, and built/tested/deployed by a GitLab CI/CD pipeline.

Staff browse a product catalogue, build a cart and place orders; the order service reserves stock through the inventory service (saga with compensation, no overselling); admins manage products; users can cancel orders and stock is restored.

## Run it locally

**Option A - Docker (everything):**

```bash
docker compose up --build        # then open http://localhost:8080
# seed demo products (one time):
docker compose exec inventory node dist/seed.js
```

Admin login: `admin@orderflow.local` / `ChangeMe123!` (set via `ADMIN_PASSWORD`). Anyone can self-register as a normal `staff` user.

**Option B - local dev (hot reload):**

```bash
# 1. Postgres with three databases
docker run -d --name of-pg -e POSTGRES_USER=orderflow -e POSTGRES_PASSWORD=orderflow -p 5432:5432 postgres:16-alpine
for d in auth inventory orders; do docker exec of-pg createdb -U orderflow orderflow_$d; done

# 2. Services (separate terminals) - migrations run automatically on start
cd services/auth      && npm i && ADMIN_EMAIL=admin@orderflow.local ADMIN_PASSWORD='ChangeMe123!' npm run dev   # :4001
cd services/inventory && npm i && npm run seed && npm run dev                                                    # :4002
cd services/orders    && npm i && npm run dev                                                                    # :4003

# 3. Frontend (Vite proxies /api/* like the nginx gateway does)
cd frontend && npm i && npm run dev                                                                              # :5173
```

## Tests

```bash
# services need a Postgres reachable via TEST_DATABASE_URL (defaults to postgres:postgres@localhost/orderflow_<svc>_test)
cd services/<auth|inventory|orders> && npm test
cd frontend && npm test
```

What was verified when this repo was assembled: 21 backend tests (including a 25-way concurrent-reservation race and the order-saga compensation path) and 7 frontend tests pass; all four packages type-check; the frontend production build succeeds; and a manual end-to-end run (register -> list -> order -> stock decremented -> cancel -> stock restored -> oversell rejected -> RBAC 403s) worked against a real PostgreSQL 16. **Not verified in the authoring sandbox** (no Docker daemon, Terraform or cluster): the Docker images, `docker compose up`, Kubernetes manifests applied to a cluster, the GitLab pipeline, and `terraform plan/apply`. YAML files were parsed for syntax only. Expect to do a first-run debugging pass on those - that is normal, and fixing it yourself is great interview material.

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
| Microservices | 3 independently deployable services, database-per-service, API gateway (nginx), shared-secret internal endpoints blocked at the gateway |
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
services/orders      Orders, cancel, saga orchestration
deploy/k8s           Kustomize manifests
deploy/terraform     AWS infrastructure
.gitlab-ci.yml       CI/CD
docker-compose.yml   Local full stack
```
