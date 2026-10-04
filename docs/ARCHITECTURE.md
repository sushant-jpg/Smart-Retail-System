# Architecture

SmartRetail uses a modular monolith for the transactional API and a separate Python intelligence service. This is a deliberate boundary: checkout, money, and inventory remain in one consistency boundary, while recommendation and forecasting workloads can scale independently.

```text
Browser / scanner
       |
    Next.js
       |
 Express API ---- Redis (ephemeral state and fan-out)
       |
 MongoDB replica set (transactional source of truth)
       |
 FastAPI intelligence service (read-only recommendations/forecasts)
```

## Core invariants

1. Money is stored and transported as integer minor units.
2. Available stock never becomes negative.
3. Every inventory change creates an immutable movement in the same transaction.
4. Financial mutations require an idempotency key.
5. Checkout totals are recalculated server-side from authoritative product prices.
6. Permissions are checked in API middleware and scoped to a store where required.
7. AI output is an estimate with an evidence-based explanation, never a claim of certainty.

## Checkout transaction

The API claims an idempotency key, opens a MongoDB transaction, loads authoritative products, calculates promotions and tax in integer arithmetic, and reserves stock using an atomic predicate (`availableQuantity >= requested`). It then writes the sale and inventory movements before committing. Concurrent buyers cannot both purchase the final unit.

## Domain boundaries

- Identity: users, sessions, roles, permissions, security events
- Catalogue: products, nested categories, barcode/QR identifiers
- Inventory: per-store balances, movements, transfers, low-stock policy
- Commerce: carts, sales, payment simulations, refunds, receipts
- Procurement: suppliers and purchase orders
- Engagement: loyalty, promotions, notifications
- Intelligence: reporting, recommendations, demand forecasts

The API folder is organized by technical layers for this vertical slice; as the domain grows, modules can be extracted behind the same route/service/model boundaries without changing clients.
