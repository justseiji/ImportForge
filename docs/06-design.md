# UI / UX specification

## Visual system

Warm canvas #f6f5f1, white surface, charcoal #202a2e, muted #64706f, border #e1e5e1, cobalt #345bd6. Sidebar #172b2a with pale text. Success #206b50, warning #8a5814, blocked #aa3740. System sans serif; monospace SKU. Sizes 12/13/14/16/24/32; line heights 1.4–1.6. Spacing 4/8/12/16/24/32/48. Radii 6/10/14. Minimal shadow only on dialogs. All interactive elements have 2px cobalt focus ring; reduced-motion disables animation. Price columns use tabular numerals and right alignment.

Wordmark: a small two-column mapping glyph + ImportForge, compact and typographic. Navigation always exposes Imports, Catalog, Suppliers, Workspace. Workspace switch label and current identity anchor the sidebar. No decorative charts.

## Screen specifications

Imports: sidebar | breadcrumb/workspace topbar | title + New import | three compact real summary counts | searchable status-filtered table | pagination. Each row: filename/source icon, supplier, stage, row count, last activity, open action. Empty: upload or download example. Processing: actual stage. Failure: readable reason and source link.

New import: centered working surface, supplier selector, file drop/input area with limits, transfer bytes/progress, sample file link, primary Upload. Parse stage leads to mapping; errors do not masquerade as successful imports.

Import workspace: breadcrumb filename + status; horizontal labeled workflow; compact source metadata; tabs Configure / Review / Receipt. Configure shows a mapping table (source header, examples, target, origin), pending suggestions panel, explicit price format/currency/defaults, category/unit dictionary text editors and blank policy. Save and validate is the primary action. Unsaved draft label is visible.

Validation/review: real summary counts, kind filter, row table with logical record, SKU/name, classification and issues/diffs. Invalid row exposes exclusion reason input. Updates expand to before → after field values. Sticky footer shows eligible scope and Commit; confirmation dialog repeats create/update/excluded counts and exact revision. Stale conflicts show refresh review action. No forced fake spinner percentages.

Receipt: success heading, actor/time/revision, counts, report download, catalog link and per-row changes. Catalog: searchable, supplier-filtered table; product detail drawer/page includes audit provenance. Suppliers: list with offering counts, create form, mapping version history. Settings: allowed category/currency/unit lists, memberships and role-sensitive edit controls.

## Responsive / accessibility

Below 900px sidebar becomes compact top navigation. Below 600px summary wraps and mapping controls stack. Tables deliberately scroll inside labeled regions; document never overflows horizontally. Buttons minimum 36px (44px on mobile). Dialog uses native `<dialog>` focus trapping and escape handling. Labels never rely on placeholders; severity is text plus color. Long filenames wrap; source cells truncate visually with full title/detail. Loading skeleton is static with readable status. Empty, error, retry, permission-denied and expired-session states have clear next actions.
