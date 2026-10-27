# Final verification report

Finalized 28 October 2026 (Asia/Manila). Full application checks completed 27 October 2026; the clean demonstration and final artifact preparation completed 28 October.

## Executed checks

| Check | Result |
|---|---|
| TypeScript `npm run typecheck` | Passed |
| ESLint `npm run lint` | Passed |
| Vitest `npm test` | **34 passed**, 2 test files, final run 5.37 seconds |
| Playwright `npm run test:e2e` | **7 passed**, final run 53.1 seconds, installed Microsoft Edge |
| Production `npm run build` | Passed; web bundle emitted to `dist/web` |
| Dependency installation audit | Last installation reported **0 vulnerabilities** |
| Mapping evaluation | 4 labeled fixtures; 11/11 predictions correct, 11/15 expected mappings found |
| Engine benchmark | 10,000 records: parse 77 ms, reconcile 103 ms; excludes database/storage/commit |
| Clean demo initialization | Two actual completed imports plus one parsed NovaTech source |
| Maintenance dry run | Passed; 0 orphan objects and 0 expired sessions |

Vitest covers structural parsing and limits, decimal/identifier preservation, deterministic transformations, mapping errors, duplicate identities, exclusions, actual reconciliation, atomic injected failure, idempotent receipt replay, repeated jobs, expired leases, stale revisions, concurrent inserts, membership revocation, workspace isolation, request Origin, provider schema rejection, bounded sampling/usage and provider-outage fallback.

The seven browser tests cover:
1. Desktop/mobile accessibility checks and screenshots.
2. Manual clean import with create/update, receipt, source trace and repeated commit.
3. Approved messy transformations with explicit blocking-record exclusion.
4. Stale preview rejection after another import modifies the catalog.
5. Mobile catalog/overview document overflow checks.
6. Multi-tab draft conflict rejection.
7. Saved mapping reuse and identical re-upload becoming unchanged.

Automated axe checks found no violations for the selected WCAG A/AA rule tags on login, overview, catalog, suppliers, settings, mapping, review and receipt states, including the mobile overview. This is an automated check, not a complete accessibility certification. Desktop and mobile screenshots were visually inspected; horizontal table scrolling remains deliberate and contained.

## Environment and measurements

Windows, Node v24.14.0, AMD Ryzen 5 3400G, 8 logical CPUs, 16 GiB system RAM. Database transaction tests use actual embedded PostgreSQL through PGlite in memory; application demonstration persists PGlite to disk. See `benchmark.json` for exact fixture size and scope, and `mapping-evaluation.json` for all labeled headers and misses. The deterministic suggestion result is not a live AI accuracy score.

Build notes: Rollup removes two third-party Zod comment annotations it cannot interpret. The build succeeds. The frontend is split into application, React/router, data and validation chunks; the largest emitted JS chunk is approximately 266 kB before gzip.

## Verification boundaries

Docker is unavailable on the authoring machine. The production Prisma/PostgreSQL daemon, Redis/BullMQ and S3/MinIO topology is implemented and documented but was **not integration-tested against those running services**. Production deployment needs that verification, TLS/reverse proxy setup and operator hardening from `docs/10-operations.md`.

No live AI key was used. Provider tests stub network responses; real provider availability, model access and latency are unverified. Manual and explicitly labeled deterministic workflows were exercised end to end.

The 20 MiB/50,000-record limits are enforced product limits. The 10k engine measurement does not establish 50k atomic commit performance. No exactly-once queue delivery or historical rollback claim is made.

Test-generated persistent data was preserved in ignored `.verification-data`; the current `.data` is a fresh demonstration workspace. The ignored `.env` contains the generated local demo password. No external publication or production credential commit was performed. See `docs/11-verification.md` for remaining product limitations, including account invitations/reset, natural-language transformation generation and retention erasure.
