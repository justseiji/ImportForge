# Verification and known limitations

The final executed results are recorded in `docs/results/verification.md`. Tests are real PostgreSQL semantics through PGlite unless explicitly labeled production. Docker/PostgreSQL daemon/Redis/S3 integration and live model calls are not claimed verified when those services are unavailable.

## Fixture expectations

`novatech-clean.csv`: fresh seed → one create (00043), one update (00042 price 425→450), one unchanged (00044); manual mappings, no default currency needed. `novatech-messy.csv`: approved trim, comma numeric format/PHP token/currency, two category mappings and pcs→piece → two creates, one update, one unchanged, two blocked. Exclude records 5/6 with reasons → commit eligible four. Repeat → four unchanged, two excluded. `conflicting-duplicates.csv`: both records blocked, even if prices happen to agree. `malformed.csv`: whole file fails, no staging/correction by guessed line boundaries.

## Important limitations

- Embedded local DB is single-process. Production adapters and Compose need an environment with Docker/services for full integration verification.
- Source upload and preview use bounded worker memory; server-side pagination slices stored JSON preview. 50,000 is a validation cap, not a measured transaction performance guarantee.
- No row-by-row fact editing: fix configuration, explicitly exclude, or upload a corrected source. There is no arbitrary spreadsheet editor.
- AI suggests column/category/unit mappings; natural-language operation generation and AI issue explanations are not exposed in this release. Money/default choices remain explicit manual controls. No live-provider accuracy claim.
- Current suggestion is persisted per revision; there is no cross-import suggestion cache. Saved mapping versions are the explicit reuse mechanism.
- No new-user invitation, password-reset, workspace switching UI or account lifecycle. Seeded roles support access demonstrations. These are required before public multi-user rollout.
- Session and orphan-object cleanup have a dry-run-first maintenance command; scheduling is an operator responsibility. Business-data retention erasure is not implemented.
- No historical rollback, import cancellation, external catalog integrations or cross-supplier product merging.
- Production TLS/reverse proxy, centralized rate limiting and least-privilege DB policy are operator responsibilities.
- Audit append-only is enforced by application paths; configure production database privileges to prevent administrative modification.

## Acceptance checks

Engine tests cover UTF-8/BOM/CSV structure, numeric formats, precision, IDs, duplicate mappings/identities, blank policies and formula-safe export. Database integration tests cover commit idempotency, repeated jobs, stale previews, concurrent creation, atomic injected failures, membership revocation and workspace filtering. Provider tests stub the network and validate bounds/invalid responses. Playwright tests exercise manual completion without an AI key, messy transforms/exclusions, repeated commit, stale review and responsive document bounds.
