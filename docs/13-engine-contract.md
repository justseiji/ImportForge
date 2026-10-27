# Deterministic preparation contract

Configuration is a strict Zod object with `version: 1`, source-to-target mappings, trim flag, one numeric format, one blank policy, explicit defaults, approved category/unit dictionaries, price currency prefix, and mapping origin. Unknown properties and unsupported target fields are rejected. No field accepts executable code.

Execution order is fixed:

1. Validate required destinations, unique destination assignments and known source headers.
2. Honor explicit record exclusions before transformation; preserve source strings and reason.
3. Read mapped source strings. Apply optional outer trim; SKU always uses NFC + outer trim.
4. Handle mapped blanks: preserve omits the patch, clear writes null only to description and blocks other fields, error emits a blocking issue.
5. Apply exact approved category/unit dictionaries. Normalize price using the single approved numeric format and optional explicit currency prefix. Active accepts only `true`/`false`.
6. Apply explicit defaults only where the transformed patch has no value. Defaults therefore can fill mapped blanks under preserve; the user explicitly selected these defaults. Without defaults, unmapped/blank optional fields retain existing values.
7. Resolve supplier/SKU against catalog and merge the patch with the existing record. New records default description to null and active to true.
8. Validate required fields, length, workspace allowlists, exact price format/range and price-prefix/currency agreement.
9. Detect duplicate normalized identities among non-excluded records, blocking all participating records.
10. Compare every supported field with the existing product to classify create/update/unchanged. Persist differences and expected product versions in the revision-bound preview.

Money never enters `Number` or `parseFloat`. Parsing constructs BigInt cents and emits a two-decimal string; PostgreSQL numeric(18,2) stores it. Zero is valid; negative amounts, exponent notation, excess precision, ambiguous symbols, misplaced grouping and currency conversion are rejected. A plain `1.234` is not silently rounded. `PHP 1,250.00` is accepted only with comma-grouped format, PHP prefix and matching PHP currency.

UTF-8 decoding is fatal on invalid bytes. BOM is accepted. Delimiter selection counts comma/semicolon/tab outside quotes in the first logical record, ties favor comma. Quoting and multiline fields use csv-parse. Blank logical records are counted in metadata and omitted from source-record ordinals. Data ordinals start at 1 after the header and count nonblank logical records, not physical lines. Structural errors reject the whole source; they cannot be reliably isolated without changing record identity. Null bytes, duplicate/empty trimmed headers, unequal field counts and declared limits fail explicitly.

The original object and raw string rows remain immutable. Every nonblank source record is represented in preview and successful receipt, including exclusions. An upload content hash is provenance, not an automatic skip rule: the same file can be intentionally reprocessed against a changed catalog. Idempotency belongs to the commit operation and receipt.
