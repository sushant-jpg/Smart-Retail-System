# Delivery roadmap

The repository implements a complete demonstration slice, not every enterprise integration in the product brief.

## Implemented foundation

- Commercial dashboard, POS, self-checkout, products, and inventory interfaces
- Responsive shell, accessible interactions, dark mode, search, alerts, and realtime connection indicator
- JWT/session authentication foundation, RBAC, request validation, and security middleware
- MongoDB models and indexes for users, stores, products, inventory, movements, sales, sessions, and audit logs
- Atomic/idempotent checkout domain service with integer-money calculations
- Explainable recommendations and weighted-average demand forecasts
- Health/readiness endpoints, OpenAPI UI, structured logging, Docker Compose, and tests

## Next production increments

1. Complete email verification/password reset delivery and the session-management screens.
2. Add purchase-order receiving, multi-store transfer, partial refund, and loyalty ledgers using the same transaction pattern as checkout.
3. Replace payment simulations with an audited payment-provider adapter only when a provider is selected.
4. Add object storage/image processing, receipt PDFs and email delivery.
5. Expand API-backed frontend mutations, offline POS queueing, and Playwright journeys.
6. Add operational dashboards, tracing, alerting, backup drills, and deployment manifests.

Each increment should include authorization tests, idempotency tests, audit coverage, and migration/rollback notes.
