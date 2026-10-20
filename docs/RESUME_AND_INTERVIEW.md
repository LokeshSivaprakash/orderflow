# Resume bullets & interview prep

## Project line for the resume

**OrderFlow - Cloud-native B2B order & inventory platform** | React, TypeScript, Node.js, PostgreSQL, Docker, Kubernetes, AWS (EKS, RDS, ECR), Terraform, GitLab CI/CD | [github.com/LokeshSivaprakash/orderflow]

- Designed and built a full-stack order management platform: React/TypeScript SPA (Redux Toolkit, RTK Query, code-splitting, WCAG-minded accessible and responsive UI) backed by four Node.js microservices (auth, inventory, orders, payments) with database-per-service PostgreSQL.
- Implemented a saga with compensating actions for cross-service order placement and row-level locking (`SELECT ... FOR UPDATE`) for stock reservation; validated with a concurrency test (25 parallel requests, zero overselling).
- Integrated Stripe Checkout (test mode) with HMAC-verified, idempotent webhooks; handled payment/cancellation races with automatic refunds and released unpaid stock via checkout-session expiry.
- Secured the system with JWT authentication, role-based authorization, zod request validation, rate limiting, Helmet headers, and Kubernetes NetworkPolicies isolating internal service endpoints.
- Containerised services with multi-stage, non-root Docker builds; authored Kubernetes manifests (probes, HPA, resource limits, Kustomize) and Terraform for AWS (VPC, EKS, RDS, ECR, Secrets Manager).
- Built a GitLab CI/CD pipeline with a parallel test matrix against ephemeral PostgreSQL, dependency auditing, Kaniko image builds to ECR, OIDC-based AWS authentication (no static keys), automated staging and gated production deploys.

(Only claim items you have actually run. Once you deploy to AWS and fix whatever breaks, the "deployed on EKS" claim becomes fully honest - and the debugging stories become your best interview answers.)

## Mapping to the job description

Use the table in `README.md`. In interviews, lead with the saga and locking story (distributed systems + database depth), then accessibility/performance (frontend depth), then the pipeline (DevOps).

## Questions to be ready for

1. *Why microservices for something this small?* Honest answer: to demonstrate service boundaries, independent deploys and the data-consistency trade-offs; a modular monolith would be the pragmatic choice at small scale, and say so.
2. *What happens if the orders service crashes after reserving stock?* Describe the gap, then the TTL-reservation / outbox fix.
3. *How do you prevent two users buying the last item?* Row locks in sorted order, single transaction, the concurrency test.
4. *Where could this be attacked?* Token storage in sessionStorage (XSS), JWT revocation, internal key rotation, rate limiting on auth only, missing HTTPS in the sample ingress.
5. *How would you scale it?* Stateless pods + HPA, read replicas for catalogue reads, cache catalogue (Redis/CloudFront), async order events via SQS/SNS.
6. *How would you roll back a bad deploy?* Immutable SHA-tagged images, `kubectl rollout undo` or re-run the previous pipeline; forward-only migrations should be backwards compatible (expand/contract).

## Stretch goals that make it stand out (pick 1-2)

- Playwright end-to-end tests in the pipeline against the compose stack.
- OpenTelemetry traces across gateway -> orders -> inventory with a Grafana dashboard.
- Replace synchronous reserve with SQS events + outbox; show idempotency keys.
- Swap RS256/JWKS for the shared secret; HttpOnly cookie sessions.
