# ImportForge

A focused supplier catalog import application. React + Fastify + PostgreSQL, with durable preparation jobs, deterministic transformations, reviewable diffs, atomic commits and source-level audit history.

## Run locally (Node.js 24)

```sh
npm ci
npm run setup
npm run demo
npm run dev
```

Open **http://localhost:5173**. Setup creates an ignored `.env` with a random local `DEMO_PASSWORD`. Sign in with `owner@importforge.local`, `editor@importforge.local`, or `viewer@importforge.local` using that password. The first API startup migrates and seeds 12 products across three suppliers. No AI key is required. Do not run a second local API against the same PGlite directory.

The local adapter persists real embedded PostgreSQL data in `.data/postgres` and immutable source objects in `.data/objects`. It runs durable jobs inside the API for convenience. Production uses PostgreSQL through Prisma, separate BullMQ workers, and private S3. Local mode is explicitly single-process; it is not the production scaling topology.

`npm run demo` is optional and runs while the API is stopped. On an empty import history, it creates two actual completed imports for Paper & Co./Linkline and a NovaTech file awaiting mapping. It preserves existing work and leaves NovaTech SKU 00042 at PHP 425.00.

## Try the complete journey

1. Browse the seeded Catalog; NovaTech SKU `00042` starts at PHP 425.00.
2. New import → NovaTech Supply → upload `apps/web/public/samples/novatech-messy.csv`.
3. Suggest mappings → accept the explicitly labeled deterministic suggestions.
4. Select comma grouping, remove the `PHP` prefix, and approve currency default PHP.
5. Category mappings: `computer accessories = Computer accessories` and `peripherals = Peripherals`. Unit mapping: `pcs = piece`.
6. Save & validate. Initial result: 2 creates, 1 update, 1 unchanged, 2 blocked.
7. Exclude records 5 and 6 with reasons (ambiguous currency and missing product name). Review the exact price diff, then commit.
8. Receipt: 2 created, 1 updated, 1 unchanged, 2 excluded, 0 rejected; all 6 source records accounted for.
9. Catalog → Wireless Mouse → history links to the source import/record. Repeat the same file/config/exclusions: 4 unchanged, 2 excluded, no duplicates.

Seed state affects create/update counts after prior imports; use fresh local data for the initial demonstration. Do not delete data you need. To use a new demo database, stop the API and move `.data` to a backup directory first.

## Commands

| Command                                                | Purpose                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------- |
| `npm run dev`                                          | API, local worker and Vite                                          |
| `npm run api` / `npm run worker`                       | Independently runnable production processes                         |
| `npm run db:migrate` / `npm run db:seed`               | Explicit database initialization                                    |
| `npm test`                                             | Engine, database transaction, security and provider tests           |
| `npm run test:e2e`                                     | Playwright against installed Microsoft Edge; requires seeded `.env` |
| `npm run typecheck` / `npm run lint` / `npm run build` | Static checks and web production bundle                             |
| `npm run evaluate` / `npm run benchmark`               | Reproducible reports under `docs/results`                           |

## Architecture and study guide

Read [product](docs/01-product.md), [architecture](docs/02-architecture.md), [database](docs/03-database.md), [API](docs/04-api.md), [frontend](docs/05-frontend.md), [design](docs/06-design.md), [security](docs/07-security.md), [plan](docs/08-plan.md), and [decisions](docs/09-decisions.md).

See [operations and scaling](docs/10-operations.md), [verification and limitations](docs/11-verification.md), and [portfolio demonstration](docs/12-portfolio.md).

### Code worth studying

- `packages/import-engine/src/index.ts`: standalone parsing, exact monetary normalization, mapping validation and reconciliation.
- `apps/api/src/imports.ts`: optimistic revisions, absence/version checks, workspace locking, atomic catalog/audit/receipt writes.
- `apps/api/src/jobs.ts`: durable job claim, leases, repeated delivery, retries and terminal state.
- `apps/api/src/server.ts`: trust boundaries, workspace-scoped reads, RBAC and idempotent commit transport.
- `apps/api/src/ai.ts`: bounded provider data, validated suggestions and deterministic fallback.
- `apps/web/src/features/imports/workspace.tsx`: explicit draft ownership, user-approved transformations, review and receipts.

No external site is published. No production credentials are bundled.
