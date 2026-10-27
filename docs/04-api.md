# API contracts

JSON except multipart uploads and CSV artifacts. Prefix `/api`. Shared Zod request schemas are authoritative. Errors: `{error:{code,message,requestId,details?}}`; 400 malformed input, 401 no session, 403 role/CSRF, 404 unavailable resource (also another workspace), 409 stale revision/preview, 413 limits, 422 invalid operation, 429 rate limit, 500 generic internal failure. Never expose source values in logs.

| Method / route                    | Contract                                                            |
| --------------------------------- | ------------------------------------------------------------------- |
| POST /auth/login                  | email/password → user, workspace, role; opaque HttpOnly cookie      |
| GET /session                      | current membership and allowed catalog values                       |
| POST /auth/logout                 | revoke session and clear cookie                                     |
| GET /imports?q=&status=&page=     | paginated queue and real counts                                     |
| POST /imports                     | multipart supplierId + file; 202 batch                              |
| GET /imports/:id                  | metadata, headers, five samples, revision, config, summary, receipt |
| GET /imports/:id/rows?page=&kind= | paginated raw/normalized/issues/diffs                               |
| POST /imports/:id/prepare         | expectedRevision + configuration + exclusions → 202                 |
| POST /imports/:id/suggest         | consent flag; bounded suggestion job → 202                          |
| POST /imports/:id/commit          | revision + idempotencyKey → 202 or existing receipt                 |
| GET /imports/:id/report           | authenticated CSV of actual receipt rows                            |
| GET /imports/:id/source           | authenticated immutable original CSV                                |
| GET /catalog?q=&supplier=&page=   | paginated products                                                  |
| GET /catalog/:id                  | product and audit trail                                             |
| GET /catalog/export               | formula-safe CSV                                                    |
| GET, POST /suppliers              | browse/create                                                       |
| GET, POST /suppliers/:id/mappings | versioned saved mapping                                             |
| GET, PUT /settings                | allowed values; owner only for writes                               |
| GET, PATCH /members/:id           | membership management; owner; never remove last owner               |
| GET /health, /ready               | liveness / database readiness                                       |

Lists return `{items,total,page,pageSize}`. Stable timestamp/ID order; page count is bounded by total. Query state belongs in URL. Source values are returned only to authenticated workspace members. Download cells starting with formula introducers are prefixed with an apostrophe; original source download remains byte-exact and is explicitly labeled untrusted.

State: parsing → mapping → preparing → review → committing → completed. Failed jobs transition to failed with actionable error. Preparation may be retried by new revision. Commit failures require refreshed review; existing successful receipts always win. No cancellation once commit starts. Upload transfer uses XHR byte progress; worker reports stage/counts only. Client polls active stages every 1 second and reloads persisted state on refresh.

Queue behavior: job lease, bounded 3 attempts, retry transient failures with backoff; terminal errors persisted. Worker crashes before transaction release lease and retry; after transaction, duplicate processing sees receipt/done state. New revisions supersede stale workers. Network timeout during commit: poll batch, retry same idempotency key only; never assume failure from disconnected response.
