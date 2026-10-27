import { cpus, totalmem, platform } from 'node:os';
import { performance } from 'node:perf_hooks';
import { parseCsv, reconcile } from '@importforge/import-engine';
import { emptyConfig } from '@importforge/contracts';
import { mkdir, writeFile } from 'node:fs/promises';
const count = 10000;
const source = Buffer.from(
  'SKU,Name,Price\n' +
    Array.from(
      { length: count },
      (_, i) => `${String(i).padStart(7, '0')},Product ${i},1250.25`,
    ).join('\n'),
);
const start = performance.now(),
  parsed = await parseCsv(source),
  parseMs = performance.now() - start;
const normalizeStart = performance.now();
const result = reconcile(
  parsed.headers,
  parsed.rows,
  {
    ...emptyConfig,
    mappings: { SKU: 'sku', Name: 'name', Price: 'price' },
    defaults: { category: 'Peripherals', currency: 'PHP', unit: 'piece' },
  },
  {},
  [],
  { categories: ['Peripherals'], currencies: ['PHP'], units: ['piece'] },
  1,
);
const report = {
  measuredAt: new Date().toISOString(),
  node: process.version,
  platform: platform(),
  cpu: cpus()[0].model,
  logicalCpus: cpus().length,
  systemMemoryGiB: Math.round(totalmem() / 1024 ** 3),
  records: count,
  bytes: source.length,
  parseMs: Math.round(parseMs),
  reconcileMs: Math.round(performance.now() - normalizeStart),
  heapUsedMiB: Math.round(process.memoryUsage().heapUsed / 1024 ** 2),
  counts: result.counts,
  scope:
    'Single in-process parse + reconciliation. Excludes database, storage, network and commit. Not a production throughput claim.',
};
await mkdir('docs/results', { recursive: true });
await writeFile('docs/results/benchmark.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
