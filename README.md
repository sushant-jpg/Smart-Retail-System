# SmartRetail

### AI-Powered Smart Retail, POS & Inventory Management Platform

SmartRetail is a production-style, multi-store retail platform with customer self-checkout, a cashier POS, inventory control, role-based administration, analytics, and explainable product recommendations.

This repository is intentionally structured as a real product rather than a CRUD demo. The current release is a polished vertical slice covering the riskiest workflows: authenticated access, permission enforcement, atomic inventory reservation, idempotent checkout, inventory movement history, explainable recommendations, realtime-ready events, and operational health checks.

## Architecture

```text
apps/web   Next.js customer, POS, and operations experiences
apps/api   Express API, MongoDB models, RBAC, checkout and inventory domain logic
apps/ai    FastAPI recommendation and demand-forecasting service
docs       Architecture, security, API, and delivery notes
```

MongoDB is the system of record. Redis is used only for ephemeral concerns (rate limits, idempotency leases, caching, and Socket.IO fan-out). Money is represented as integer minor units everywhere.

## Quick start

### Docker (recommended)

```bash
cp .env.example .env
docker compose up --build
```

Open:

- Web application: http://localhost:3000
- REST API: http://localhost:4000
- Swagger UI: http://localhost:4000/docs
- AI service docs: http://localhost:8000/docs

### Local development

Requirements: Node.js 20+, npm 10+, Python 3.11+, MongoDB, and Redis.

```bash
npm install
npm run dev
```

Signed-in catalog, checkout, profile, inventory, and dashboard workflows load from the API. For a populated local demo, seed a disposable database using the guarded demo seeder described below; the application does not substitute demo figures when live dashboard data fails.

The API demo seed resets the selected database before inserting fixtures. Run it only against a disposable local database and explicitly set `ALLOW_DEMO_SEED_RESET=true`.

## Setup

1. Install Node.js 20+ and npm 10+; install Python 3.11+ for the AI service.
2. Copy `.env.example` to `.env`. Use unique local secrets, set `MONGODB_URI` and `REDIS_URL` to reachable services, and keep `NODE_ENV=development`.
3. Run `npm install` and start the application with Docker Compose or `npm run dev`.
4. To load demo records, verify the selected MongoDB database is disposable, explicitly set `ALLOW_DEMO_SEED_RESET=true`, then run `npm run seed`.
5. Visit the web app at `http://localhost:3000` and use the demo credentials below.

## Useful commands

```bash
npm run dev          # run web and API together
npm run build        # compile all Node workspaces
npm test             # run unit tests
npm run typecheck    # TypeScript checks
npm run lint         # lint the web app
```

Run the AI service independently:

```bash
cd apps/ai
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Demo paths

- `/dashboard` — manager overview with KPI and sales intelligence
- `/pos` — keyboard-friendly cashier flow with a functioning cart
- `/scan-pay` — customer self-checkout experience
- `/inventory` — inventory health, low-stock risks, and movement visibility
- `/products` — searchable product catalogue administration
- `/login` — accessible authentication experience

## Security highlights

- Short-lived JWT access tokens and hashed, rotating refresh tokens
- Permission checks enforced by API middleware, not only hidden in the UI
- Account lockout and login rate limiting
- Strict Zod validation for environment and request inputs
- Atomic inventory predicates prevent negative stock
- Idempotency keys prevent duplicate checkout processing
- Structured, redacted request logging and auditable domain changes
- Secure headers, restricted CORS, cookie hardening, and request IDs

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/SECURITY.md](docs/SECURITY.md), and [docs/ROADMAP.md](docs/ROADMAP.md) for the design and delivery boundary.

## Problem

Independent retailers need reliable checkout and inventory operations across stores, while common demo systems leave stock correctness, staff permissions, and transaction recovery as UI-only concerns.

## Solution

SmartRetail provides a coherent customer, cashier, and store-operations slice. Transactional decisions stay in the API, money is handled as integer minor units, and inventory changes are auditable and safe under concurrency.

## Major features

- Customer product search, self-checkout, promotion and loyalty redemption, order history, and receipts
- Cashier POS with product search, barcode/SKU/signed-QR lookup, customer lookup, and checkout
- Store-scoped products, inventory, low-stock monitoring, suppliers, and purchase orders
- Role-based administration, audit records, security events, and active session management
- Backend-driven analytics for revenue, orders, profit estimate, customers, products, categories, payment methods, and store comparisons
- Explainable recommendations and demand forecasts from the separate AI service

## Tech stack

- Web: Next.js, React, TypeScript, Tailwind CSS, TanStack Query, Recharts
- API: Node.js, Express, TypeScript, Mongoose, Zod, Socket.IO
- Data and ephemeral infrastructure: MongoDB replica set, Redis
- Intelligence: Python, FastAPI, pytest
- Validation: Vitest, Playwright, TypeScript, ESLint, Docker Compose

## Screenshots

No screenshot files are currently committed. The main review routes are `/dashboard`, `/products`, `/pos`, `/scan-pay`, `/inventory`, and `/profile`. Playwright retains screenshots and traces for failed runs under the web workspace test-results directory.

## POS

The POS supports catalogue search, category filters, barcode/SKU/QR lookup, quantity adjustment, customer attachment, promotion and loyalty entry, server-quoted checkout, payment simulation, and receipt retrieval. It requires the API and a seeded development database for a complete live-data demonstration.

## Product media and camera scanning

Products keep using the existing `images: string[]` field. The seeded catalogue uses stable, application-owned artwork served from `apps/web/public/products/`; API image values are limited to those public asset paths or HTTPS URLs, and legacy filesystem/internal paths are omitted from responses. If an existing local demo database has empty image arrays, run `npm run backfill:product-images -w @smartretail/api` with `MONGODB_URI` set to that local `smartretail` database. The backfill only fills missing/empty images and refuses non-local hosts, other databases, and production.

Scan & Pay supports a connected keyboard-wedge barcode scanner or manual SKU/barcode/signed-QR entry everywhere. Camera scanning uses the browser's native `BarcodeDetector` when supported; it starts only after the user presses **Start scanner**, prefers the rear camera on mobile, and stops the media tracks after a scan or when the component unmounts. Browser camera access requires HTTPS or localhost and camera/QR-barcode format support. Permission, hardware, or browser limitations leave manual lookup available; decoded values are always validated by the API before adding a product.

## Checkout architecture

The API creates an idempotent payment attempt and calculates a quote using current product prices, promotion eligibility, tax, stock, and loyalty balance. Before confirmation it recalculates the quote. If prices, stock, or eligibility changed, it returns `PRICE_CHANGED` with the refreshed quote; the UI displays the revised total and requires another explicit confirmation. Successful checkout records the sale and inventory movements transactionally.

## Inventory concurrency

Checkout and inventory movements use MongoDB transactions and atomic quantity predicates. Competing purchases for the last unit cannot both complete, and purchase-order receiving/refunds also guard against duplicate or excessive updates. Integration tests require a MongoDB replica set.

## QR security

Product QR payloads use a compact, versioned signed identifier. The protected product-label endpoint returns an SVG generated from the signed payload; the product detail UI displays it in a modal with PNG download and print-label controls. The API validates the signature before resolving a scanned product; QR values are not trusted as client-supplied product data.

## RBAC

Roles include `CUSTOMER`, `CASHIER`, `STORE_STAFF`, `STORE_MANAGER`, `ADMIN`, and `SUPER_ADMIN`. The API enforces permissions and store scope on protected operations; frontend visibility is not the authorization boundary.

## Loyalty

The API supports tiered accounts, point earning and redemption, expiry, and reversal paths. The customer profile reads the current tier and balance from the loyalty API.

## Notifications

Operational notifications are persisted and exposed through the API. Socket.IO can invalidate affected UI data when inventory, sales, or notifications change; the pages also support normal API refetching.

## Testing

```bash
npm run typecheck
npm run lint
npm test
npm run build
py -3.12 -m pytest -q
npm run test:integration
npm run test:e2e
npm audit --omit=dev
docker compose config --quiet
```

Integration tests use `docker-compose.integration.yml` and a replica-set MongoDB on port `27018`. Playwright starts isolated local API and web servers on ports `4001` and `3001`, uses MongoDB database `smartretail_e2e` and Redis logical database `1`, then seeds dedicated accounts per role, project, and worker. Its test-only proxy mode is restricted to loopback, keeps the production login limits enabled, and uses unique synthetic client IPs per test so the IP limiter remains exercised without tests sharing counters. The suite runs one worker because some scenarios intentionally change shared catalog data; accounts and client IPs remain worker-isolated if parallelism is enabled later. The demo database and existing local services are not modified; the dedicated E2E database is reset before each full run. E2E tests use live APIs and can create sales in that isolated database.

## Docker

Copy `.env.example` to `.env`, replace the development-only secrets for your environment, then run `docker compose up --build -d`. Check service state with `docker compose ps`, API liveness at `/health/live`, and dependency readiness at `/health/ready`. Docker Engine must be running.

## Environment variables

The full local template is [.env.example](./.env.example). Important settings:

- `MONGODB_URI`, `REDIS_URL`, `AI_SERVICE_URL`
- `API_PORT`, `WEB_PORT`, `AI_PORT`, `WEB_ORIGIN`, `NEXT_PUBLIC_API_URL`
- `HOST_WEB_PORT`, `HOST_API_PORT`, `HOST_AI_PORT`, `HOST_MONGO_PORT`, `HOST_REDIS_PORT` control Docker host port publishing independently of in-container service ports
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET`, `QR_SIGNING_SECRET`
- `EMAIL_PROVIDER`, `EMAIL_FROM`, and `SMTP_URL` when using SMTP delivery
- `LOYALTY_EXPIRY_INTERVAL_MS`

Production mode requires dedicated secrets and SMTP configuration. Never commit real credentials or reuse the example values in production.

## API docs

With the API running, Swagger UI is available at `http://localhost:4000/docs`; health checks are `/health/live` and `/health/ready`. The AI service exposes its OpenAPI UI at `http://localhost:8000/docs`.

## Demo accounts

After seeding a disposable local database, the following accounts are available. The shared password is `DemoPass!2026`.

| Account | Role |
| --- | --- |
| `customer@smartretail.demo` | Customer |
| `kabir@smartretail.demo` | Customer |
| `cashier@smartretail.demo` | Cashier |
| `staff@smartretail.demo` | Store staff |
| `manager@smartretail.demo` | Store manager |
| `admin@smartretail.demo` | Super admin |

Seeding is destructive to the selected database and is disabled unless `ALLOW_DEMO_SEED_RESET=true` is explicitly set. Do not use demo credentials or seed data in production.

## Known limitations

- Payment is simulated; no external payment processor is integrated.
- Email defaults to development mode; configure SMTP for real delivery.
- Screenshots are not yet committed, and browser coverage does not certify every viewport or accessibility scenario.
- MongoDB replica-set and Redis services are required for full integration tests and transactional workflows.
- Forecasts and recommendations are decision-support outputs, not guaranteed outcomes.
