import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { connect, migrate } from '../apps/api/src/db.ts';
import { seed } from '../apps/api/src/seed.ts';
import { storage } from '../apps/api/src/storage.ts';
import { upload, prepare, requestCommit } from '../apps/api/src/imports.ts';
import { runJob } from '../apps/api/src/jobs.ts';
import { emptyConfig } from '@importforge/contracts';
import type { Actor } from '../apps/api/src/auth.ts';
const db = await connect();
if (!db.local) throw new Error('Demo history is local-only.');
await migrate(db);
await seed(db);
const actor: Actor = {
    userId: 'user-owner',
    workspaceId: 'ws-demo',
    role: 'owner',
    name: 'Alex Morgan',
    email: 'owner@importforge.local',
  },
  store = storage();
if ((await db.query('SELECT id FROM imports LIMIT 1')).length) {
  console.log('Imports already exist; preserving this workspace.');
  await db.close();
  process.exit(0);
}
async function runStage(importId: string, kind: string) {
  const [j] = await db.query(
    'SELECT id FROM jobs WHERE import_id=$1 AND kind=$2 ORDER BY created_at DESC LIMIT 1',
    [importId, kind],
  );
  await runJob(db, store, j.id);
}
for (const fixture of [
  {
    supplier: 'sup-paper',
    filename: 'paper-co_october-pricelist.csv',
    csv: 'SKU,Name,Price,Category,Currency,Unit\nP-100,A4 Copy Paper · 500 sheets,250.00,Office supplies,PHP,piece\nP-103,Document Folder · Kraft,65.00,Office supplies,PHP,piece',
  },
  {
    supplier: 'sup-link',
    filename: 'linkline_cable-catalog.csv',
    csv: 'SKU,Name,Price,Category,Currency,Unit\nL-200,USB-C Cable · 1 meter,195.00,Cables & adapters,PHP,piece\nL-203,DisplayPort Cable · 2 meters,450.00,Cables & adapters,PHP,piece',
  },
]) {
  const b = await upload(
    db,
    store,
    actor,
    fixture.supplier,
    fixture.filename,
    Buffer.from(fixture.csv),
  );
  await runStage(b.id, 'parse');
  await prepare(db, actor, b.id, {
    expectedRevision: 0,
    config: {
      ...emptyConfig,
      mappings: {
        SKU: 'sku',
        Name: 'name',
        Price: 'price',
        Category: 'category',
        Currency: 'currency',
        Unit: 'unit',
      },
    },
    exclusions: {},
  });
  await runStage(b.id, 'prepare');
  await requestCommit(db, actor, b.id, 1, `demo-${b.id}`);
  await runStage(b.id, 'commit');
}
const b = await upload(
  db,
  store,
  actor,
  'sup-nova',
  'novatech_october-update.csv',
  await readFile('apps/web/public/samples/novatech-messy.csv'),
);
await runStage(b.id, 'parse');
await db.close();
console.log(
  'Created two real completed imports and one source awaiting mapping. NovaTech 00042 remains at PHP 425.00.',
);
