# Threat model and data handling

Assets: supplier files, product prices, workspace memberships, sessions, model credentials and audit trail. Attackers include unauthenticated callers, a malicious workspace member and hostile CSV content.

- Authentication uses Argon2id password verification and random opaque 32-byte sessions; only session digests stored. HttpOnly SameSite=Lax cookies; Secure in production; 12-hour expiry. Login rate limiting is per IP; use trusted proxy only in known deployment. No custom encryption. Demo seed password is supplied by environment, never a production credential.
- Mutations check Origin against APP_ORIGIN and require JSON or multipart content. Same-origin deployment, no wildcard CORS. Every route checks membership and editor/owner permission; every query filters workspace, including jobs and downloads. Unknown cross-workspace IDs yield 404.
- CSV values are inert text. React escapes output. Formula-safe CSV exports. Never execute transformations as code. Parser fails the whole file on malformed structure to avoid ambiguous row identities. UTF-8 validation is strict.
- Private objects use generated keys, never filename paths. Upload cap applies server-side. SHA-256 detects content identity but does not deduplicate import operations. Source objects never overwrite. Local storage is a development adapter only. S3 IAM limited to bucket/prefix, TLS, encryption at rest and lifecycle retention are deployment responsibilities.
- Provider requests require user consent and contain headers plus at most five bounded sample rows. Provider output is schema-validated with allowlisted target fields and operations. Uploaded instructions are data, not authority. Timeouts and retries bounded; credentials never enter browser. Logs omit request bodies, cookies, authorization and sample values.
- Role changes protect the last owner. Catalog commit rights rechecked at execution, preventing a queued job from retaining revoked permissions.
- Production backups must include DB + source objects; retention/deletion policy must be set before real supplier use. Initial app has no self-service retention erasure or malware scanning; CSV only, no execution.

Operational hardening before public deployment: TLS reverse proxy, least-privilege DB roles including immutable audit permissions, Redis private networking, S3 lifecycle orphan cleanup, session cleanup schedule, secret manager, backups/restore drill and centralized rate limiting for multiple API replicas.
