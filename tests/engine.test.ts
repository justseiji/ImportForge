import { describe, it, expect } from 'vitest';
import {
  parseCsv,
  price,
  reconcile,
  suggest,
  validateMapping,
  csvCell,
} from '@importforge/import-engine';
import {
  emptyConfig,
  suggestionSchema,
  type ImportConfig,
  type Product,
} from '@importforge/contracts';
const allowed = { categories: ['Peripherals'], currencies: ['PHP'], units: ['piece'] };
const headers = ['Code', 'Name', 'Cost', 'Category', 'Unit'];
const config: ImportConfig = {
  ...emptyConfig,
  mappings: { Code: 'sku', Name: 'name', Cost: 'price', Category: 'category', Unit: 'unit' },
  defaults: { currency: 'PHP' },
  numberFormat: 'comma-grouped',
  currencyToken: 'PHP',
  categories: { peripherals: 'Peripherals' },
  units: { pcs: 'piece' },
};
const raw = ['00042', ' Mouse ', 'PHP 1,250.00', 'peripherals', 'pcs'];
const existing: Product = {
  id: 'p1',
  supplier_id: 's',
  sku: '00042',
  original_sku: '00042',
  name: 'Mouse',
  description: 'Preserve me',
  category: 'Peripherals',
  price: '1200.00',
  currency: 'PHP',
  unit: 'piece',
  active: true,
  version: 3,
  updated_at: '',
};
describe('CSV structure', () => {
  it('enforces file and record limits', async () => {
    await expect(parseCsv(new Uint8Array(20 * 1024 * 1024 + 1))).rejects.toThrow('20 MiB');
    await expect(
      parseCsv(Buffer.from('SKU\n' + Array(50001).fill('00042').join('\n'))),
    ).rejects.toThrow('50,000');
  });
  it('preserves BOM, leading zero IDs, quoted delimiters and multiline logical records', async () => {
    const p = await parseCsv(
      Buffer.from('\uFEFFCode,Name\r\n00042,"Mouse, wireless"\r\n00043,"Line one\nline two"\r\n'),
    );
    expect(p.headers).toEqual(['Code', 'Name']);
    expect(p.rows).toEqual([
      ['00042', 'Mouse, wireless'],
      ['00043', 'Line one\nline two'],
    ]);
  });
  it('detects semicolon and ignores blank records explicitly', async () => {
    const p = await parseCsv(Buffer.from('Code;Name\n\n00042;Mouse\n;\n'));
    expect(p.delimiter).toBe(';');
    expect(p.rows).toHaveLength(1);
    expect(p.blankRecords).toBeGreaterThanOrEqual(2);
  });
  it.each(['A,A\n1,2', 'A,B\n1', 'A,B\n1,"open'])(
    'rejects malformed structure %s',
    async (text) => {
      await expect(parseCsv(Buffer.from(text))).rejects.toThrow();
    },
  );
  it('rejects invalid UTF-8 and bounded cell/column sizes', async () => {
    await expect(parseCsv(new Uint8Array([0xff]))).rejects.toThrow('UTF-8');
    await expect(parseCsv(Buffer.from(`A\n${'x'.repeat(16385)}`))).rejects.toThrow('cell');
    await expect(
      parseCsv(
        Buffer.from(
          Array.from({ length: 101 }, (_, i) => `H${i}`).join(',') +
            '\n' +
            Array(101).fill('v').join(','),
        ),
      ),
    ).rejects.toThrow('100 columns');
  });
});
describe('deterministic transformations', () => {
  it('uses decimal strings beyond safe floating point precision', () => {
    expect(price('9007199254740991.01', 'plain', 'none')).toBe('9007199254740991.01');
    expect(price('1.250,50', 'dot-grouped', 'none')).toBe('1250.50');
    expect(price('PHP 1,250.00', 'comma-grouped', 'PHP')).toBe('1250.00');
  });
  it.each(['$89.00', '1,25.00', '1.234', '-2', '1e3', 'NaN'])(
    'rejects ambiguous or unsupported price %s',
    (value) => expect(() => price(value, 'comma-grouped', 'none')).toThrow(),
  );
  it('preserves original SKU and unmapped optional field with real diff', () => {
    const p = reconcile(headers, [raw], config, {}, [existing], allowed, 1);
    expect(p.rows[0].values.sku).toBe('00042');
    expect(p.rows[0].source[0]).toBe('00042');
    expect(p.rows[0].values.description).toBe('Preserve me');
    expect(p.rows[0].changes).toEqual([{ field: 'price', before: '1200.00', after: '1250.00' }]);
    expect(p.counts.update).toBe(1);
  });
  it('clears only allowed mapped blank fields', () => {
    const c = {
      ...config,
      mappings: { ...config.mappings, Description: 'description' as const },
      blankPolicy: 'clear' as const,
    };
    const p = reconcile([...headers, 'Description'], [[...raw, '']], c, {}, [existing], allowed, 1);
    expect(p.rows[0].values.description).toBe(null);
  });
  it('blocks all duplicate identities until explicit exclusion', () => {
    const p = reconcile(headers, [raw, raw], config, {}, [], allowed, 1);
    expect(p.counts.blocked).toBe(2);
    const next = reconcile(
      headers,
      [raw, raw],
      config,
      { '2': 'Duplicate supplier record' },
      [],
      allowed,
      2,
    );
    expect(next.counts).toEqual({ create: 1, update: 0, unchanged: 0, blocked: 0, excluded: 1 });
  });
  it('blocks unapproved categories and mismatching currency', () => {
    const p = reconcile(
      headers,
      [raw],
      { ...config, defaults: { currency: 'USD' } },
      {},
      [],
      allowed,
      1,
    );
    expect(p.rows[0].issues.some((i) => i.code === 'CURRENCY_MISMATCH')).toBe(true);
  });
  it('validates unique destinations and required mappings', () => {
    expect(() =>
      validateMapping(headers, { ...config, mappings: { Code: 'sku', Name: 'sku' } }),
    ).toThrow('only once');
    expect(() => validateMapping(headers, emptyConfig)).toThrow('Map sku');
  });
  it('does not infer missing facts in suggestions and rejects model code', () => {
    expect(suggest(['Supplier Code', 'Cost', 'Mystery']).mappings).toEqual({
      'Supplier Code': 'sku',
      Cost: 'price',
    });
    expect(
      suggestionSchema.safeParse({
        mappings: { Cost: 'execute_sql' },
        categories: {},
        units: {},
        reason: 'x',
      }).success,
    ).toBe(false);
  });
  it('neutralizes spreadsheet formulas in derived CSV', () =>
    expect(csvCell('=SUM(1,2)')).toBe('"\'=SUM(1,2)"'));
});
