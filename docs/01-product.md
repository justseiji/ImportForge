# ImportForge product requirements

## Outcome and boundaries

Catalog managers convert supplier CSV records into a persistent catalog through Upload → Inspect → Map → Transform → Validate → Review → Commit → Receipt. A catalog record is a supplier offering, not a cross-supplier master product. No inventory, orders, deletes-by-absence, arbitrary code transformations, currency conversion, or historical rollback.

Editors upload and prepare imports; owners also configure allowed values and access; viewers read catalog, receipts and history. All operations occur inside one authenticated workspace. Initial local seed is a small Philippine distributor with realistic peripherals and office supplies.

## Journeys

1. Returning manager opens Imports, selects supplier and uploads a CSV. Transfer completion is separate from queued parsing. File problems are explained before mapping.
2. Manager inspects headers and source samples, accepts deterministic or live provider suggestions, edits destinations and normalization dictionaries, and explicitly selects a numeric format and blank policy. Required mapping omissions prevent preview.
3. Validation produces blocking issues tied to logical source records. Manager changes configuration or excludes individual records with a reason. Every change creates an immutable revision and invalidates review.
4. Review compares staged products with current catalog, including field-level diffs. Manager commits the displayed revision. A stale catalog requires new review. A retry retrieves the original receipt.
5. Catalog history links back to import and source record. A repeat upload produces unchanged records, not duplicates. Supplier mapping versions can be reused after exact header validation.

## Acceptance criteria

- UTF-8 BOM, quoted delimiters and multiline fields parse; duplicate headers, malformed records and invalid UTF-8 fail explicitly.
- `00042` remains an identifier. PHP 1,250.00 becomes exactly 1250.00 only under approved numeric/currency rules.
- Optional unmapped fields remain untouched. Mapped blanks follow preserve/clear/error policy; clear only applies to description.
- Duplicate normalized SKUs block every participating record until excluded or corrected by a new source upload.
- No catalog writes before commit. All eligible writes, receipt and audit records succeed or fail together.
- An affected product version changing, or a concurrent creation of a proposed new identity, prevents an outdated commit.
- Excluded + blocked + creates + updates + unchanged equals source records at preview; successful receipt has zero rejected rows.
- Viewer mutations and cross-workspace IDs are rejected server-side.
- Manual import remains fully functional without a model key.

## Initial limits and success measures

20 MiB uploads, 50,000 nonblank logical records, 100 columns, 16 KiB per cell; not a throughput promise. Pagination defaults to 25, maximum 100. Measure correctness first, then report measured parsing/normalization performance separately. No fabricated AI quality scores or progress percentages.
