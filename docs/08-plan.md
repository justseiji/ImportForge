# Implementation phases and verification gates

1. Foundation: workspace packages, contracts, SQL schema/Prisma adapter, local PostgreSQL adapter, authentication, deterministic seeds and tokens. Gate: authenticated/unauthenticated and role boundaries.
2. Catalog/suppliers: browse, export, detail/history, allowed values. Gate: pagination, filtering, workspace isolation, safe CSV.
3. Ingestion: private immutable upload, hash, durable parse jobs, stable logical records. Gate: BOM/quotes/multiline/UTF-8/header/limit fixtures.
4. Preparation: mapping, explicit decimal format/defaults/dictionaries/blank policies, immutable revisions, exclusion reasons. Gate: identifier/decimal preservation, duplicate blocking, transformation validation.
5. Preview/commit: actual diffs, stale revision/version checks, advisory lock, receipt/audit atomicity, idempotency. Gate: duplicate request, concurrent create, stale update, injected failure, accounting.
6. AI: deterministic demo heuristics and optional structured provider adapter with consent. Gate: schema rejection, timeout/manual fallback and labeled mapping evaluation.
7. Reuse/operations: saved mapping versions, report download, retries/leases/recovery/graceful shutdown. Gate: repeated jobs, stale worker and refresh recovery.
8. Polish/evaluation: desktop/mobile browser inspection, E2E journeys, build/typecheck/lint, performance fixture, documentation and demo script. Report unavailable checks honestly.

Dependencies: phases 3–5 require engine + schema; AI depends on a complete manual flow. Scaling follows measurement: separate workers, connection pooling, normalized preview rows, bounded DB staging batches, shared S3, Redis metrics. Changing transaction semantics is a product decision, not an invisible optimization.
