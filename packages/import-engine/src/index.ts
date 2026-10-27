import { parse } from 'csv-parse';
import {
  configSchema,
  fields,
  type Allowed,
  type ImportConfig,
  type Preview,
  type PreviewRow,
  type Product,
  type ProductValues,
  type Suggestion,
} from '@importforge/contracts';
export const LIMITS = { bytes: 20 * 1024 * 1024, records: 50000, columns: 100, cell: 16384 };
export class ImportError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function parseCsv(
  bytes: Uint8Array,
): Promise<{ headers: string[]; rows: string[][]; delimiter: string; blankRecords: number }> {
  if (bytes.byteLength > LIMITS.bytes)
    throw new ImportError('FILE_TOO_LARGE', 'CSV exceeds 20 MiB.');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    throw new ImportError('ENCODING', 'Only valid UTF-8 CSV is supported.');
  }
  if (!text.trim()) throw new ImportError('EMPTY_FILE', 'The file is empty.');
  // Count separators outside quotes in the first logical record, not first physical line.
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        i++;
        continue;
      }
      quoted = !quoted;
    }
    if (!quoted) {
      if (c === '\n' || c === '\r') break;
      if (c in counts) counts[c]++;
    }
  }
  const delimiter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const parser = parse(text, {
    delimiter,
    bom: true,
    skip_empty_lines: false,
    relax_column_count: true,
    max_record_size: LIMITS.columns * LIMITS.cell,
  });
  let headers: string[] = [];
  const rows: string[][] = [];
  let blankRecords = 0;
  try {
    for await (const record of parser as AsyncIterable<string[]>) {
      if (record.every((v) => !v.trim())) {
        blankRecords++;
        continue;
      }
      if (record.length > LIMITS.columns)
        throw new ImportError('COLUMN_LIMIT', 'At most 100 columns are supported.');
      if (record.some((v) => Buffer.byteLength(v, 'utf8') > LIMITS.cell))
        throw new ImportError('CELL_LIMIT', 'A cell exceeds 16,384 UTF-8 bytes.');
      if (record.some((v) => v.includes('\0')))
        throw new ImportError('NULL_BYTE', 'Null bytes cannot be stored as catalog text.');
      if (!headers.length) {
        headers = record.map((v) => v.trim());
        if (headers.some((v) => !v) || new Set(headers).size !== headers.length)
          throw new ImportError('HEADERS', 'Headers must be nonempty and unique after trimming.');
      } else {
        if (record.length !== headers.length)
          throw new ImportError(
            'MALFORMED_CSV',
            `Record ${rows.length + 1} has ${record.length} columns; expected ${headers.length}. No records were accepted.`,
          );
        rows.push(record);
        if (rows.length > LIMITS.records)
          throw new ImportError('ROW_LIMIT', 'At most 50,000 source records are supported.');
      }
    }
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError(
      'MALFORMED_CSV',
      `The CSV structure is invalid. No records were accepted. ${e instanceof Error ? e.message : 'Check quoting and column counts.'}`,
    );
  }
  if (!rows.length) throw new ImportError('NO_RECORDS', 'The CSV has no data records.');
  return { headers, rows, delimiter, blankRecords };
}
export const normalizeSku = (s: string) => s.normalize('NFC').trim();
export function price(
  value: string,
  format: ImportConfig['numberFormat'],
  token: ImportConfig['currencyToken'],
): string {
  let s = value.trim();
  if (token !== 'none') s = s.replace(new RegExp(`^${token}\\s+`), '').trim();
  const patterns = {
    plain: /^\d+(?:\.\d{1,2})?$/,
    'comma-grouped': /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/,
    'dot-grouped': /^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/,
  };
  if (!patterns[format].test(s))
    throw new ImportError(
      'PRICE_FORMAT',
      'Price does not match the approved format; symbols and ambiguous decimals require clarification.',
    );
  if (format === 'comma-grouped') s = s.replaceAll(',', '');
  if (format === 'dot-grouped') s = s.replaceAll('.', '').replace(',', '.');
  const [whole, fraction = ''] = s.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > 999999999999999999n)
    throw new ImportError('PRICE_RANGE', 'Price exceeds the supported range.');
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}
export function validateMapping(headers: string[], config: ImportConfig) {
  configSchema.parse(config);
  const mapped = Object.values(config.mappings);
  if (new Set(mapped).size !== mapped.length)
    throw new ImportError('DUPLICATE_MAPPING', 'Each destination field may be mapped only once.');
  if (Object.keys(config.mappings).some((h) => !headers.includes(h)))
    throw new ImportError('UNKNOWN_HEADER', 'A mapped source header no longer exists.');
  for (const field of ['sku', 'name', 'price', 'category', 'currency', 'unit'] as const)
    if (!mapped.includes(field) && !(field in config.defaults))
      throw new ImportError('MISSING_MAPPING', `Map ${field} or approve an allowed default.`);
}
export function reconcile(
  headers: string[],
  rows: string[][],
  config: ImportConfig,
  exclusions: Record<string, string>,
  products: Product[],
  allowed: Allowed,
  revision: number,
): Preview {
  validateMapping(headers, config);
  const catalog = new Map(products.map((p) => [p.sku, p]));
  const output: PreviewRow[] = rows.map((source, index) => {
    const record = index + 1;
    const base: PreviewRow = {
      record,
      source,
      values: {},
      kind: 'blocked',
      issues: [],
      changes: [],
    };
    if (exclusions[String(record)])
      return { ...base, kind: 'excluded', reason: exclusions[String(record)] };
    const values: Record<string, unknown> = {};
    const issue = (field: string, message: string, code = 'INVALID', original?: string) =>
      base.issues.push({ field, message, code, severity: 'error', original });
    for (const [header, field] of Object.entries(config.mappings)) {
      const raw = source[headers.indexOf(header)] ?? '';
      let value = config.trim ? raw.trim() : raw;
      if (!value.trim()) {
        if (config.blankPolicy === 'error')
          issue(field, 'Mapped blank value is not allowed.', 'BLANK', raw);
        else if (config.blankPolicy === 'clear') {
          if (field === 'description') values[field] = null;
          else issue(field, 'Only description may be cleared.', 'CLEAR_REQUIRED', raw);
        }
        continue;
      }
      if (field === 'sku') value = normalizeSku(value);
      if (field === 'category') value = config.categories[value] ?? value;
      if (field === 'unit') value = config.units[value] ?? value;
      if (field === 'price') {
        try {
          values.price = price(value, config.numberFormat, config.currencyToken);
        } catch (e) {
          issue(field, (e as Error).message, 'PRICE_FORMAT', raw);
        }
        continue;
      }
      if (field === 'active') {
        if (!['true', 'false'].includes(value))
          issue(field, 'Active must be true or false.', 'ACTIVE', raw);
        else values.active = value === 'true';
        continue;
      }
      values[field] = value;
    }
    for (const [key, value] of Object.entries(config.defaults))
      if (values[key] === undefined && value)
        values[key] = key === 'active' ? value === 'true' : value;
    const existing = typeof values.sku === 'string' ? catalog.get(values.sku) : undefined;
    const merged = {
      ...(existing ?? { description: null, active: true }),
      ...values,
    } as ProductValues;
    for (const field of ['sku', 'name', 'price', 'category', 'currency', 'unit'] as const)
      if (!merged[field]) issue(field, `${field} is required.`, 'REQUIRED');
    for (const [field, list] of [
      ['category', allowed.categories],
      ['currency', allowed.currencies],
      ['unit', allowed.units],
    ] as const)
      if (merged[field] && !list.includes(merged[field]))
        issue(field, `“${merged[field]}” is not an allowed ${field}.`, 'NOT_ALLOWED');
    if (config.currencyToken !== 'none' && merged.currency !== config.currencyToken)
      issue('currency', 'The approved price token and currency must agree.', 'CURRENCY_MISMATCH');
    if (merged.name?.length > 300) issue('name', 'Product name exceeds 300 characters.', 'LENGTH');
    if (merged.sku?.length > 120) issue('sku', 'SKU exceeds 120 characters.', 'LENGTH');
    base.values = merged;
    if (existing) {
      base.productId = existing.id;
      base.expectedVersion = existing.version;
      for (const field of fields)
        if (merged[field] !== existing[field])
          base.changes.push({ field, before: existing[field], after: merged[field] });
    } else
      for (const field of fields) base.changes.push({ field, before: null, after: merged[field] });
    base.kind = base.issues.some((i) => i.severity === 'error')
      ? 'blocked'
      : !existing
        ? 'create'
        : base.changes.length
          ? 'update'
          : 'unchanged';
    return base;
  });
  const identities = new Map<string, PreviewRow[]>();
  for (const row of output)
    if (row.kind !== 'excluded' && row.values.sku) {
      const group = identities.get(row.values.sku) ?? [];
      group.push(row);
      identities.set(row.values.sku, group);
    }
  for (const group of identities.values())
    if (group.length > 1)
      for (const row of group) {
        row.kind = 'blocked';
        row.issues.push({
          code: 'DUPLICATE_SKU',
          severity: 'error',
          field: 'sku',
          message: `SKU repeats in records ${group.map((r) => r.record).join(', ')}. Exclude duplicates explicitly.`,
        });
      }
  const counts = { create: 0, update: 0, unchanged: 0, blocked: 0, excluded: 0 };
  for (const row of output) counts[row.kind]++;
  return { revision, rows: output, counts, preparedAt: new Date().toISOString() };
}
export function suggest(headers: string[]): Suggestion {
  const aliases: Record<string, string[]> = {
    sku: ['sku', 'supplier code', 'product code', 'item code'],
    name: ['name', 'item description', 'product name', 'item name'],
    description: ['description', 'details'],
    price: ['price', 'cost', 'unit price'],
    category: ['category', 'group'],
    currency: ['currency', 'ccy'],
    unit: ['uom', 'unit', 'unit of measure'],
    active: ['active', 'active status'],
  };
  const mappings: Suggestion['mappings'] = {};
  for (const header of headers) {
    const match = Object.entries(aliases).find(([, names]) =>
      names.includes(header.trim().toLowerCase()),
    );
    if (match && !Object.values(mappings).includes(match[0] as never))
      mappings[header] = match[0] as keyof ProductValues;
  }
  return {
    mappings,
    categories: {},
    units: {},
    reason:
      'Deterministic header aliases only. Review every mapping; price formats, currencies, categories and units require your approval.',
  };
}
export function csvCell(value: unknown) {
  let s = String(value ?? '');
  if (/^[\s]*[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}
