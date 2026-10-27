import { suggest } from '@importforge/import-engine';
import { writeFile, mkdir } from 'node:fs/promises';
const fixtures = [
  {
    headers: ['Supplier Code', 'Item Description', 'Cost', 'Group', 'UOM'],
    expected: {
      'Supplier Code': 'sku',
      'Item Description': 'name',
      Cost: 'price',
      Group: 'category',
      UOM: 'unit',
    },
  },
  {
    headers: ['SKU', 'Product name', 'Unit price', 'Category', 'Currency', 'Unit'],
    expected: {
      SKU: 'sku',
      'Product name': 'name',
      'Unit price': 'price',
      Category: 'category',
      Currency: 'currency',
      Unit: 'unit',
    },
  },
  {
    headers: ['Material Ref', 'Label', 'Net Amount', 'Measure'],
    expected: { 'Material Ref': 'sku', Label: 'name', 'Net Amount': 'price', Measure: 'unit' },
  },
  { headers: ['Mystery', 'Notes from vendor'], expected: {} },
];
let correct = 0,
  total = 0,
  predicted = 0;
const results = fixtures.map((f) => {
  const result = suggest(f.headers);
  predicted += Object.keys(result.mappings).length;
  for (const [h, target] of Object.entries(f.expected)) {
    total++;
    if (result.mappings[h] === target) correct++;
  }
  return { ...f, actual: result.mappings };
});
const report = {
  mode: 'deterministic (not live AI)',
  fixtures: results.length,
  correct,
  expected: total,
  predicted,
  precision: correct / predicted,
  recall: correct / total,
  results,
  limitations:
    'Small hand-labeled English header set; no calibration, no live-provider measurement, no category inference. Unknown headers intentionally require manual mapping.',
};
await mkdir('docs/results', { recursive: true });
await writeFile('docs/results/mapping-evaluation.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
