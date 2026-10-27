# Operations, deployment and scaling

## Local

Node 24, npm lockfile. `npm ci`, `npm run setup`, `npm run dev`. Local startup automatically migrates and seeds only an empty database. Password changes in `.env` do not silently change existing users. Back up `.data` while stopped; do not open one PGlite directory from concurrent processes.

## Docker infrastructure

Set `POSTGRES_PASSWORD`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and `DEMO_PASSWORD` in an ignored `.env`. Use URL-safe DB password characters or percent-encode the connection URL. `docker compose up -d postgres redis minio bucket` starts infrastructure. Set `APP_MODE=production`, PostgreSQL URL, Redis URL and S3 settings from `.env.example`, then migrate/seed and run API + worker. Full process images: `docker compose --profile app up --build`. Docker is not available in the authoring environment; this topology requires deployment validation.

Production cookies require HTTPS. Serve `dist/web` behind a TLS reverse proxy with SPA fallback and forward `/api` to API port 3001. Set APP_ORIGIN to the exact external origin. Do not enable wildcard CORS. The Compose app profile intentionally does not expose a public reverse proxy or issue certificates. Static frontend hosting plus same-origin API routing is a deployment prerequisite. Include `X-Content-Type-Options: nosniff`, a restrictive CSP (`default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'`), HSTS and Referrer-Policy at the edge. Development Vite has different requirements.

Migration SQL is authoritative; Prisma provides a maintained PostgreSQL adapter and parameterized raw SQL for the shared repository. Do not use Prisma schema push against the partial client bootstrap model. The initial idempotent SQL migration is applied by `db:migrate`; introduce a versioned migration ledger before schema evolution beyond this initial release.

## Jobs and recovery

Accepted operations insert durable DB jobs. Production worker dispatch scans every two seconds and sends pending/expired work to BullMQ. Database claim uses `FOR UPDATE SKIP LOCKED`; lease is ten minutes. Worker concurrency is two. Duplicate messages are intentionally allowed. Source parsing is idempotent, preparation checks current revision, and commits first check unique receipt. Jobs retry at most three execution attempts. Terminal failures persist on imports; user creates a new preparation revision to retry. Requeue of a completed transaction sees existing receipt.

Graceful shutdown stops accepting API requests or closes the worker and waits for its active operation. Killing a worker before transaction completion causes DB rollback; lease expiry enables recovery. Killing after success preserves receipt and completion, regardless of queue acknowledgement. A user with an uncertain commit response polls the persisted import; same revision/key is safe to resend.

The lease is a recovery timer, not an exactly-once guarantee. Workspace locks and receipt uniqueness protect duplicated execution even if a long-running operation outlives its lease. Preparation and catalog commits serialize per workspace; read pages remain available. Source uploads never depend on local API memory after acceptance.

## Operational tasks and limits

Monitor queue age, failed job counts, transaction duration, DB storage growth, object bytes, provider latency/failures and receipt accounting. `/api/health` is process liveness; `/api/ready` verifies database access (does not certify Redis/S3/provider health). Logs omit bodies and cookie values. Add request/job/workspace context to centralized logs without recording CSV samples.

Upload rollback removes its object on ordinary transaction failure. A process death between object write and DB insertion can leave an orphan. `npm run maintenance` is a dry run; `npm run maintenance -- --apply` removes only generated UUID objects absent from source metadata and older than 24 hours, plus expired sessions. It supports local storage and S3; run local maintenance while the API is stopped. Schedule it in production after verifying storage policy. Referenced source files are retained; no business-data retention erasure policy is enabled. Establish retention and object/DB backup consistency before real customer use. No malware execution surface exists; antivirus scanning remains an optional deployment policy.

## Scaling boundaries

1. API: stateless sessions in DB; horizontally replicate behind reverse proxy. Replace per-instance rate limiter with shared Redis enforcement before public multi-instance deployment.
2. Workers: independent workspaces parallelize. Workspace advisory lock deliberately serializes writers within one workspace. Tune concurrency against DB connection and transaction latency, not CPU count alone.
3. Database: source rows indexed/persisted in batches. Preview currently stored as one bounded JSONB snapshot, loaded and paginated server-side; normalize preview rows and fetch pages directly for heavy usage. Catalog export currently materializes results; stream it for large catalogs.
4. Memory: upload bytes and decoded CSV are bounded at 20 MiB; worker also holds normalized rows. This is bounded parsing, not constant-memory ingestion. Move upload to presigned multipart S3 and streaming stage batches when measured use requires it.
5. Transactions: bounded imports commit atomically, with a 120-second production transaction timeout. No 50k commit throughput claim. Large imports require measurement and potentially versioned catalog publication; chunked catalog writes cannot silently replace all-or-nothing behavior.
6. Storage/queue: use shared S3 with bucket versioning/lifecycle and durable Redis. Database outbox survives enqueue failure. DB backups and object restore tests are mandatory operational work.
