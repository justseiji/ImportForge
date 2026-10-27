# 90-second demonstration

- **0–10s:** Catalog: point out NovaTech SKU 00042 at PHP 425.00; same SKU is allowed for another supplier. Open Imports.
- **10–25s:** New import, choose NovaTech, upload messy example. Show source headers and preserved leading zeros. Explain uploads do not modify catalog.
- **25–45s:** Accept labeled deterministic suggestions, choose comma grouping and PHP prefix/default, category dictionary and pcs→piece. Save & validate. Mention live AI is optional and never runs code.
- **45–60s:** Show 425→450 field diff. Show two blocking records. Exclude each with a specific reason; demonstrate every record remains accounted for.
- **60–75s:** Confirm revision and counts; commit. Receipt proves atomic result, actor and source hash. Download report.
- **75–90s:** Open Wireless Mouse history and follow source record link. Show a prepared repeat import with unchanged rows. Explain unique supplier/SKU identity and commit idempotency.

## Engineering decisions to discuss in interviews

**Idempotency is a database property.** A disabled button cannot stop network retries or duplicate queue deliveries. A unique import receipt plus transactional catalog writes gives a stable retry result. Queue delivery remains at-least-once.

**Preview is a versioned promise.** A preview binds configuration revision and catalog versions, including absence for creates. A later insert must invalidate a create preview just as an update invalidates a version. Workspace locking simplifies coordinating these checks with writes; identity uniqueness is a second defense.

**Money and identifiers have different semantics.** SKU strings preserve zeros; cents are computed with BigInt; PostgreSQL stores numeric(18,2). Currency remains explicit. Locale ambiguity is a user decision, not a parser guess.

**Atomicity includes evidence.** Product mutations, receipt and audit happen in one transaction. A crash cannot leave unrecorded successful changes. Test by injecting failure after the first write and proving that products, receipt and audit are all absent.

**A queue is not the business database.** Durable jobs are inserted with revisions/attempts in PostgreSQL; Redis accelerates execution. Publish failures do not lose accepted work. Stale workers check revision before publishing results.

**AI and deterministic correctness are separate.** Header suggestion quality is evaluated on labeled fixtures. Engine/transaction correctness is tested independently. Provider output is untrusted schema-validated data, with bounded samples and manual fallback.

**Tradeoffs should be named.** Workspace serialization, bounded in-memory preparation, JSON previews and local PGlite make this implementation understandable. The scaling plan describes exactly where each choice becomes a bottleneck rather than presenting speculative microservices.
