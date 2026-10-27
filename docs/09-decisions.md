# Architecture decisions

## ADR 001 — Modular monolith

Accepted. One domain model and transaction boundary make audits and commits understandable. Separate API/worker processes scale CPU/IO independently without distributed business transactions. Extract services only for a measured ownership or throughput boundary.

## ADR 002 — PostgreSQL authority, at-least-once delivery

Accepted. Durable DB jobs bridge DB/Redis publish failure. Re-delivery is harmless because revision checks and receipts are authoritative. Redis availability affects latency, not whether an accepted job exists.

## ADR 003 — Explicit money and identifier semantics

Accepted. Decimal strings become BigInt cents for normalization; DB numeric(18,2). Never convert money with Number/parseFloat. SKU NFC+trim is case-sensitive. Reject ambiguous prices/currency symbols rather than guessing.

## ADR 004 — Preview-bound atomic commits

Accepted. Snapshot binds revision and affected product versions including absence. Workspace advisory lock plus unique identity constraint prevent races. This serializes a workspace's writers but keeps all-or-nothing semantics practical for bounded batches. Historical rollback deferred.

## ADR 005 — Human-approved deterministic operations

Accepted. AI suggests schema-validated configuration only. Manual mapping always available. Deterministic demo mode is named explicitly. Provider output cannot perform writes or invent facts.

## ADR 006 — Local PostgreSQL demo adapter

Accepted for developer convenience because Docker is unavailable in the authoring environment. PGlite runs real PostgreSQL semantics in-process; production path uses Prisma/PostgreSQL. Local filesystem and polling jobs are clearly limited to one API process. Test production Redis/S3/Prisma topology separately before deployment.

## Sources consulted

- [Fastify validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)
- [Prisma transaction reference](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions)
- [BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs)
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat) — strict response schema plus independent Zod and workspace-allowlist validation.
