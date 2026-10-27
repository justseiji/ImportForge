import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { connect, migrate, type Database, json } from '../apps/api/src/db.ts';
import { seed } from '../apps/api/src/seed.ts';
import {
  batch,
  upload,
  prepare,
  requestCommit,
  executeCommit,
  executePrepare,
  detail,
  products,
} from '../apps/api/src/imports.ts';
import { runJob } from '../apps/api/src/jobs.ts';
import { createServer } from '../apps/api/src/server.ts';
import { providerSuggestion, executeSuggest } from '../apps/api/src/ai.ts';
import type { Storage } from '../apps/api/src/storage.ts';
import type { Actor } from '../apps/api/src/auth.ts';
import { emptyConfig, type ImportConfig } from '@importforge/contracts';
const actor: Actor = {
  userId: 'user-owner',
  workspaceId: 'ws-demo',
  role: 'owner',
  name: 'Alex',
  email: 'owner@importforge.local',
};
const objects = new Map<string, Buffer>();
const store: Storage = {
  async put(k, b) {
    objects.set(k, b);
  },
  async get(k) {
    return objects.get(k)!;
  },
  async remove(k) {
    objects.delete(k);
  },
};
const config: ImportConfig = {
  ...emptyConfig,
  mappings: { SKU: 'sku', Name: 'name', Price: 'price' },
  defaults: { category: 'Peripherals', currency: 'PHP', unit: 'piece' },
};
let db: Database;
beforeAll(async () => {
  db = await connect(true);
  await migrate(db);
  await seed(db, 'test-password-2026');
});
afterAll(async () => db.close());
async function staged(sku: string, value = '123.45') {
  const b = await upload(
    db,
    store,
    actor,
    'sup-nova',
    'test.csv',
    Buffer.from(`SKU,Name,Price\n${sku},Test product,${value}\n`),
  );
  const [parseJob] = await db.query("SELECT id FROM jobs WHERE import_id=$1 AND kind='parse'", [
    b.id,
  ]);
  await runJob(db, store, parseJob.id);
  await prepare(db, actor, b.id, { expectedRevision: 0, config, exclusions: {} });
  const [prepJob] = await db.query("SELECT id FROM jobs WHERE import_id=$1 AND kind='prepare'", [
    b.id,
  ]);
  await runJob(db, store, prepJob.id);
  return b.id;
}
async function commitJob(importId: string, key: string) {
  await requestCommit(db, actor, importId, 1, key);
  const [j] = await db.query(
    "SELECT * FROM jobs WHERE import_id=$1 AND kind='commit' ORDER BY created_at DESC",
    [importId],
  );
  return j;
}
describe('real PostgreSQL import transactions', () => {
  it('commits atomically, accounts for records and returns receipt on repeated request/job', async () => {
    const importId = await staged('TEST-0001');
    const j = await commitJob(importId, 'idempotency-0001');
    await executeCommit(db, j);
    await executeCommit(db, j);
    const result = await requestCommit(db, actor, importId, 1, 'idempotency-0001');
    expect(result.receipt.counts.total).toBe(1);
    expect(result.receipt.counts.create).toBe(1);
    expect(
      (
        await db.query('SELECT * FROM audit_events WHERE import_id=$1 AND product_id IS NOT NULL', [
          importId,
        ])
      ).length,
    ).toBe(1);
    expect(
      (await products(db, 'ws-demo', 'sup-nova')).filter((p) => p.sku === 'TEST-0001'),
    ).toHaveLength(1);
  });
  it('reimporting identical records is unchanged', async () => {
    const importId = await staged('TEST-0001');
    expect((await detail(db, actor, importId)).counts.unchanged).toBe(1);
    await executeCommit(db, await commitJob(importId, 'repeat-file-0001'));
  });
  it('detects concurrent new identities; one commit wins', async () => {
    const first = await staged('CONCURRENT-01'),
      second = await staged('CONCURRENT-01');
    const j1 = await commitJob(first, 'concurrent-first'),
      j2 = await commitJob(second, 'concurrent-second');
    const results = await Promise.allSettled([executeCommit(db, j1), executeCommit(db, j2)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await db.query("SELECT id FROM products WHERE sku='CONCURRENT-01'")).length).toBe(1);
  });
  it('rejects catalog version drift and rolls back injected partial writes', async () => {
    const importId = await staged('ATOMIC-01');
    const j = await commitJob(importId, 'atomic-failure-01');
    await expect(executeCommit(db, j, true)).rejects.toThrow('Injected');
    expect((await db.query("SELECT * FROM products WHERE sku='ATOMIC-01'")).length).toBe(0);
    expect((await db.query('SELECT * FROM receipts WHERE import_id=$1', [importId])).length).toBe(
      0,
    );
    expect(
      (
        await db.query('SELECT * FROM audit_events WHERE import_id=$1 AND product_id IS NOT NULL', [
          importId,
        ])
      ).length,
    ).toBe(0);
    await executeCommit(db, j);
    const update = await staged('ATOMIC-01', '150.00');
    const j2 = await commitJob(update, 'stale-version-01');
    await db.query("UPDATE products SET version=version+1 WHERE sku='ATOMIC-01'");
    await expect(executeCommit(db, j2)).rejects.toThrow('Catalog changed');
  });
  it('invalidates old revisions and prevents stale worker output', async () => {
    const importId = await staged('REVISION-01');
    const [old] = await db.query("SELECT * FROM jobs WHERE import_id=$1 AND kind='prepare'", [
      importId,
    ]);
    await prepare(db, actor, importId, {
      expectedRevision: 1,
      config,
      exclusions: { '1': 'Not required' },
    });
    await executePrepare(db, old);
    expect((await batch(db, 'ws-demo', importId)).preview).toBe(null);
    await expect(requestCommit(db, actor, importId, 1, 'old-preview-01')).rejects.toThrow(
      'current preview',
    );
    const [current] = await db.query(
      "SELECT id FROM jobs WHERE import_id=$1 AND kind='prepare' AND revision=2",
      [importId],
    );
    await runJob(db, store, current.id);
    expect((await detail(db, actor, importId)).counts.excluded).toBe(1);
  });
  it('isolates workspaces and enforces viewer permissions', async () => {
    const importId = await staged('ISOLATION-01');
    await expect(batch(db, 'different-workspace', importId)).rejects.toThrow('not found');
    await expect(
      prepare(db, { ...actor, role: 'viewer' }, importId, {
        expectedRevision: 1,
        config,
        exclusions: {},
      }),
    ).rejects.toThrow('editor');
  });
  it('reclaims an expired lease and safely replays parse', async () => {
    const b = await upload(
      db,
      store,
      actor,
      'sup-nova',
      'lease.csv',
      Buffer.from('SKU,Name,Price\nLEASE-01,Item,1.00'),
    );
    const [j] = await db.query('SELECT id FROM jobs WHERE import_id=$1', [b.id]);
    await db.query(
      "UPDATE jobs SET status='running',lease_until=now()-interval '1 minute' WHERE import_id=$1",
      [b.id],
    );
    await runJob(db, store, j.id);
    expect((await batch(db, 'ws-demo', b.id)).row_count).toBe(1);
    await db.query("UPDATE jobs SET status='pending' WHERE import_id=$1", [b.id]);
    await runJob(db, store, j.id);
    expect((await db.query('SELECT * FROM source_rows WHERE import_id=$1', [b.id])).length).toBe(1);
  });
  it('rejects commit if actor loses editor membership after enqueue', async () => {
    const importId = await staged('REVOKED-01');
    const j = await commitJob(importId, 'revoked-actor-01');
    await db.query("UPDATE memberships SET role='viewer' WHERE user_id='user-owner'");
    await expect(executeCommit(db, j)).rejects.toThrow('revoked');
    await db.query("UPDATE memberships SET role='owner' WHERE user_id='user-owner'");
  });
});
describe('HTTP trust boundaries', () => {
  it('authenticates sessions, checks Origin and denies viewer mutations', async () => {
    const app = await createServer(db, store, false);
    const origin = process.env.APP_ORIGIN ?? 'http://localhost:5173';
    expect((await app.inject({ method: 'GET', url: '/api/catalog' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'viewer@importforge.local', password: 'test-password-2026' },
        })
      ).statusCode,
    ).toBe(403);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin },
      payload: { email: 'viewer@importforge.local', password: 'test-password-2026' },
    });
    expect(login.statusCode).toBe(200);
    const cookie = login.cookies[0];
    const headers = { origin, cookie: `session=${cookie.value}` };
    expect((await app.inject({ method: 'GET', url: '/api/catalog', headers })).statusCode).toBe(
      200,
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/suppliers',
          headers,
          payload: { name: 'Denied', contact: '' },
        })
      ).statusCode,
    ).toBe(403);
    await app.close();
  });
  it('filters catalog records from another workspace', async () => {
    await db.query('INSERT INTO workspaces VALUES($1,$2,$3::jsonb)', [
      'ws-other',
      'Other',
      json({ categories: [], currencies: [], units: [] }),
    ]);
    await db.query(
      "INSERT INTO suppliers(id,workspace_id,name) VALUES('other-supplier','ws-other','Private supplier')",
    );
    await db.query(
      "INSERT INTO products(id,workspace_id,supplier_id,sku,original_sku,name,category,price,currency,unit) VALUES('secret','ws-other','other-supplier','00042','00042','Secret','Private',1,'PHP','piece')",
    );
    expect((await products(db, 'ws-demo', 'other-supplier')).length).toBe(0);
  });
});
describe('provider failure boundaries', () => {
  it('falls back to deterministic suggestions after a provider outage', async () => {
    const importId = await staged('FALLBACK-01');
    const previous = process.env.AI_API_KEY;
    process.env.AI_API_KEY = 'test-only-key';
    const fetcher = vi.fn(async () => new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    try {
      await executeSuggest(db, {
        workspace_id: 'ws-demo',
        import_id: importId,
        revision: 1,
        payload: { consent: true },
      });
      const result = await detail(db, actor, importId);
      expect(result.suggestion.mode).toBe('deterministic');
      expect(result.suggestion.notice).toContain('failed');
      expect(result.status).toBe('review');
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      if (previous === undefined) delete process.env.AI_API_KEY;
      else process.env.AI_API_KEY = previous;
    }
  });
  it('rejects arbitrary target fields in structured output', async () => {
    const fake = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  mappings: { Cost: 'sql' },
                  categories: {},
                  units: {},
                  reason: 'bad',
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    await expect(providerSuggestion(['Cost'], [['1']], {}, fake as typeof fetch)).rejects.toThrow();
  });
  it('bounds samples and preserves actual usage', async () => {
    let payload: any;
    const fake = async (_url: any, options: any) => {
      payload = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  mappings: { Cost: 'price' },
                  categories: {},
                  units: {},
                  reason: 'Cost header',
                }),
              },
            },
          ],
          usage: { total_tokens: 37 },
        }),
        { status: 200 },
      );
    };
    const result = await providerSuggestion(
      ['Cost'],
      Array(10).fill(['x'.repeat(500)]),
      {},
      fake as typeof fetch,
    );
    expect(JSON.parse(payload.messages[1].content).samples).toHaveLength(5);
    expect(JSON.parse(payload.messages[1].content).samples[0][0]).toHaveLength(120);
    expect(result.usage.total_tokens).toBe(37);
  });
});
