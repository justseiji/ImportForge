import { randomUUID, createHash } from 'node:crypto';
import { type ImportConfig, type Preview, type Product, emptyConfig } from '@importforge/contracts';
import { parseCsv, reconcile } from '@importforge/import-engine';
import { type Database, type Sql, json, lock } from './db.ts';
import { AppError, requireRole, type Actor } from './auth.ts';
import type { Storage } from './storage.ts';
export const id = () => randomUUID();
export async function batch(db: Sql, workspace: string, importId: string) {
  const [row] = await db.query(
    'SELECT i.*,s.filename,s.sha256,s.bytes,s.storage_key,p.name AS supplier_name,u.name AS owner FROM imports i JOIN sources s ON s.id=i.source_id JOIN suppliers p ON p.id=i.supplier_id JOIN users u ON u.id=i.created_by WHERE i.id=$1 AND i.workspace_id=$2',
    [importId, workspace],
  );
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Import not found.');
  return row;
}
export async function job(
  tx: Sql,
  actor: Actor,
  importId: string,
  kind: string,
  revision: number,
  payload: unknown = {},
) {
  await tx.query(
    'INSERT INTO jobs(id,workspace_id,import_id,kind,revision,actor_id,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',
    [id(), actor.workspaceId, importId, kind, revision, actor.userId, json(payload)],
  );
}
export async function upload(
  db: Database,
  store: Storage,
  actor: Actor,
  supplierId: string,
  filename: string,
  bytes: Buffer,
) {
  requireRole(actor, 'editor');
  if (
    !(
      await db.query('SELECT id FROM suppliers WHERE id=$1 AND workspace_id=$2', [
        supplierId,
        actor.workspaceId,
      ])
    ).length
  )
    throw new AppError(404, 'NOT_FOUND', 'Supplier not found.');
  if (bytes.length > 20 * 1024 * 1024)
    throw new AppError(413, 'FILE_LIMIT', 'The file exceeds 20 MiB.');
  const key = id(),
    importId = id(),
    sourceId = id();
  await store.put(key, bytes);
  try {
    await db.transaction(async (tx) => {
      await tx.query(
        'INSERT INTO sources(id,workspace_id,storage_key,filename,sha256,bytes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          sourceId,
          actor.workspaceId,
          key,
          filename.slice(0, 250),
          createHash('sha256').update(bytes).digest('hex'),
          bytes.length,
          actor.userId,
        ],
      );
      await tx.query(
        "INSERT INTO imports(id,workspace_id,supplier_id,source_id,created_by,status) VALUES($1,$2,$3,$4,$5,'parsing')",
        [importId, actor.workspaceId, supplierId, sourceId, actor.userId],
      );
      await job(tx, actor, importId, 'parse', 0);
    });
  } catch (e) {
    await store.remove(key);
    throw e;
  }
  return { id: importId };
}
export async function prepare(
  db: Database,
  actor: Actor,
  importId: string,
  input: { expectedRevision: number; config: ImportConfig; exclusions: Record<string, string> },
) {
  requireRole(actor, 'editor');
  return db.transaction(async (tx) => {
    await lock(tx, actor.workspaceId);
    const b = await batch(tx, actor.workspaceId, importId);
    if (['completed', 'committing', 'parsing'].includes(b.status))
      throw new AppError(409, 'STATE', 'This import cannot be edited in its current stage.');
    if (b.revision !== input.expectedRevision)
      throw new AppError(
        409,
        'REVISION_CONFLICT',
        'Another tab changed this import. Reload before saving.',
      );
    if (Object.keys(input.exclusions).some((n) => Number(n) < 1 || Number(n) > b.row_count))
      throw new AppError(400, 'EXCLUSION_RANGE', 'Excluded record is outside this source file.');
    const revision = b.revision + 1;
    await tx.query(
      'INSERT INTO revisions(import_id,number,config,exclusions,created_by) VALUES($1,$2,$3::jsonb,$4::jsonb,$5)',
      [importId, revision, json(input.config), json(input.exclusions), actor.userId],
    );
    await tx.query(
      'INSERT INTO audit_events(id,workspace_id,import_id,actor_id,kind,detail) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
      [
        id(),
        actor.workspaceId,
        importId,
        actor.userId,
        'preparation-approved',
        json({
          revision,
          origin: input.config.origin,
          suggestion: b.suggestion ?? null,
          approvedConfig: input.config,
          exclusions: input.exclusions,
        }),
      ],
    );
    await tx.query(
      "UPDATE imports SET revision=$1,status='preparing',preview=NULL,error=NULL,updated_at=now() WHERE id=$2",
      [revision, importId],
    );
    await job(tx, actor, importId, 'prepare', revision);
    return { revision };
  });
}
export async function requestCommit(
  db: Database,
  actor: Actor,
  importId: string,
  revision: number,
  key: string,
) {
  requireRole(actor, 'editor');
  return db.transaction(async (tx) => {
    await lock(tx, actor.workspaceId);
    const b = await batch(tx, actor.workspaceId, importId);
    const [receipt] = await tx.query(
      'SELECT * FROM receipts WHERE import_id=$1 AND workspace_id=$2',
      [importId, actor.workspaceId],
    );
    if (receipt) return { receipt };
    const [attempt] = await tx.query(
      'SELECT * FROM commit_attempts WHERE workspace_id=$1 AND key=$2',
      [actor.workspaceId, key],
    );
    if (attempt) {
      if (attempt.import_id !== importId || attempt.revision !== revision)
        throw new AppError(409, 'KEY_REUSED', 'This idempotency key belongs to another operation.');
      return { attempt };
    }
    if (b.status !== 'review' || b.revision !== revision || b.preview?.revision !== revision)
      throw new AppError(
        409,
        'STALE_PREVIEW',
        'Refresh and review a current preview before committing.',
      );
    if (b.preview.counts.blocked)
      throw new AppError(
        422,
        'BLOCKED_ROWS',
        'Resolve or explicitly exclude every blocked record.',
      );
    const attemptId = id();
    await tx.query(
      'INSERT INTO commit_attempts(id,workspace_id,import_id,revision,key,actor_id) VALUES($1,$2,$3,$4,$5,$6)',
      [attemptId, actor.workspaceId, importId, revision, key, actor.userId],
    );
    await tx.query(
      "UPDATE imports SET status='committing',error=NULL,updated_at=now() WHERE id=$1",
      [importId],
    );
    await job(tx, actor, importId, 'commit', revision, { attemptId });
    return { attempt: { id: attemptId, status: 'pending' } };
  });
}
export async function products(db: Sql, workspace: string, supplier: string): Promise<Product[]> {
  return db.query(
    'SELECT id,supplier_id,sku,original_sku,name,description,category,price::text,currency,unit,active,version,updated_at FROM products WHERE workspace_id=$1 AND supplier_id=$2',
    [workspace, supplier],
  );
}
export async function executeParse(db: Database, store: Storage, j: any) {
  const b = await batch(db, j.workspace_id, j.import_id);
  if (b.status !== 'parsing') return;
  const parsed = await parseCsv(await store.get(b.storage_key));
  await db.transaction(async (tx) => {
    await lock(tx, j.workspace_id);
    const current = await batch(tx, j.workspace_id, j.import_id);
    if (current.status !== 'parsing') return;
    // Batched JSON record expansion keeps large ingestion out of per-row round trips.
    for (let offset = 0; offset < parsed.rows.length; offset += 500) {
      const chunk = parsed.rows
        .slice(offset, offset + 500)
        .map((values, i) => ({ ordinal: offset + i + 1, values }));
      await tx.query(
        'INSERT INTO source_rows(import_id,ordinal,values) SELECT $1,x.ordinal,x.values FROM jsonb_to_recordset($2::jsonb) AS x(ordinal integer,values jsonb) ON CONFLICT DO NOTHING',
        [j.import_id, json(chunk)],
      );
    }
    await tx.query(
      "UPDATE imports SET headers=$1::jsonb,row_count=$2,metadata=$3::jsonb,status='mapping',updated_at=now() WHERE id=$4",
      [
        json(parsed.headers),
        parsed.rows.length,
        json({ delimiter: parsed.delimiter, blankRecords: parsed.blankRecords }),
        j.import_id,
      ],
    );
  });
}
export async function executePrepare(db: Database, j: any) {
  await db.transaction(async (tx) => {
    await lock(tx, j.workspace_id);
    const b = await batch(tx, j.workspace_id, j.import_id);
    if (b.revision !== j.revision || b.status !== 'preparing') return;
    const [revision] = await tx.query('SELECT * FROM revisions WHERE import_id=$1 AND number=$2', [
      j.import_id,
      j.revision,
    ]);
    const [workspace] = await tx.query('SELECT allowed FROM workspaces WHERE id=$1', [
      j.workspace_id,
    ]);
    const rows = await tx.query(
      'SELECT values FROM source_rows WHERE import_id=$1 ORDER BY ordinal',
      [j.import_id],
    );
    const preview = reconcile(
      b.headers,
      rows.map((r) => r.values),
      revision.config,
      revision.exclusions,
      await products(tx, j.workspace_id, b.supplier_id),
      workspace.allowed,
      j.revision,
    );
    await tx.query(
      "UPDATE imports SET preview=$1::jsonb,status='review',error=NULL,updated_at=now() WHERE id=$2 AND revision=$3",
      [json(preview), j.import_id, j.revision],
    );
  });
}
export async function executeCommit(db: Database, j: any, injectFailure = false) {
  await db.transaction(async (tx) => {
    await lock(tx, j.workspace_id);
    const b = await batch(tx, j.workspace_id, j.import_id);
    if ((await tx.query('SELECT id FROM receipts WHERE import_id=$1', [j.import_id])).length)
      return;
    if (b.revision !== j.revision || b.status !== 'committing')
      throw new AppError(409, 'STALE_PREVIEW', 'Import revision changed. Prepare a fresh review.');
    const [member] = await tx.query(
      'SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2',
      [j.workspace_id, j.actor_id],
    );
    if (!member || member.role === 'viewer')
      throw new AppError(403, 'FORBIDDEN', 'Commit permission was revoked.');
    const preview = b.preview as Preview;
    if (!preview || preview.counts.blocked)
      throw new AppError(422, 'BLOCKED', 'The preview contains blocking records.');
    const current = await products(tx, j.workspace_id, b.supplier_id);
    const bySku = new Map(current.map((p) => [p.sku, p]));
    const [workspace] = await tx.query('SELECT allowed FROM workspaces WHERE id=$1', [
      j.workspace_id,
    ]);
    for (const row of preview.rows) {
      if (row.kind === 'excluded') continue;
      const existing = bySku.get(row.values.sku!);
      if (
        (row.productId &&
          (!existing ||
            existing.id !== row.productId ||
            existing.version !== row.expectedVersion)) ||
        (!row.productId && existing)
      )
        throw new AppError(
          409,
          'STALE_CATALOG',
          `Catalog changed since review (record ${row.record}). Refresh the preview.`,
        );
      const v = row.values;
      if (
        !workspace.allowed.categories.includes(v.category) ||
        !workspace.allowed.currencies.includes(v.currency) ||
        !workspace.allowed.units.includes(v.unit)
      )
        throw new AppError(
          409,
          'SETTINGS_CHANGED',
          'Allowed catalog values changed. Refresh the preview.',
        );
    }
    for (const row of preview.rows) {
      if (!['create', 'update'].includes(row.kind)) continue;
      const v = row.values;
      const productId = row.productId ?? id();
      if (row.kind === 'create') {
        const [rev] = await tx.query(
          'SELECT config FROM revisions WHERE import_id=$1 AND number=$2',
          [j.import_id, j.revision],
        );
        const skuHeader = Object.entries(rev.config.mappings).find(
          ([, field]) => field === 'sku',
        )![0];
        await tx.query(
          'INSERT INTO products(id,workspace_id,supplier_id,sku,original_sku,name,description,category,price,currency,unit,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::numeric,$10,$11,$12)',
          [
            productId,
            j.workspace_id,
            b.supplier_id,
            v.sku,
            row.source[b.headers.indexOf(skuHeader)],
            v.name,
            v.description ?? null,
            v.category,
            v.price,
            v.currency,
            v.unit,
            v.active,
          ],
        );
      } else
        await tx.query(
          'UPDATE products SET name=$1,description=$2,category=$3,price=$4::numeric,currency=$5,unit=$6,active=$7,version=version+1,updated_at=now() WHERE id=$8 AND workspace_id=$9',
          [
            v.name,
            v.description ?? null,
            v.category,
            v.price,
            v.currency,
            v.unit,
            v.active,
            productId,
            j.workspace_id,
          ],
        );
      await tx.query(
        'INSERT INTO audit_events(id,workspace_id,product_id,import_id,record,actor_id,kind,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
        [
          id(),
          j.workspace_id,
          productId,
          j.import_id,
          row.record,
          j.actor_id,
          row.kind,
          json({ revision: j.revision, changes: row.changes }),
        ],
      );
      if (injectFailure) throw new Error('Injected transaction failure');
    }
    if (Object.values(preview.counts).reduce((a, b) => a + b, 0) !== b.row_count)
      throw new Error('Receipt accounting invariant failed');
    await tx.query(
      'INSERT INTO receipts(id,workspace_id,import_id,revision,attempt_id,actor_id,counts) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [
        id(),
        j.workspace_id,
        j.import_id,
        j.revision,
        j.payload.attemptId,
        j.actor_id,
        json({ ...preview.counts, rejected: 0, total: b.row_count }),
      ],
    );
    await tx.query("UPDATE commit_attempts SET status='completed' WHERE id=$1", [
      j.payload.attemptId,
    ]);
    await tx.query(
      "UPDATE imports SET status='completed',error=NULL,updated_at=now() WHERE id=$1",
      [j.import_id],
    );
    await tx.query("UPDATE jobs SET status='done',lease_until=NULL WHERE id=$1", [j.id]);
  });
}
export async function detail(db: Sql, actor: Actor, importId: string) {
  const b = await batch(db, actor.workspaceId, importId);
  const [rev] = await db.query('SELECT * FROM revisions WHERE import_id=$1 AND number=$2', [
    importId,
    b.revision,
  ]);
  const samples = await db.query(
    'SELECT ordinal,values FROM source_rows WHERE import_id=$1 ORDER BY ordinal LIMIT 5',
    [importId],
  );
  const [receipt] = await db.query(
    'SELECT r.*,u.name AS actor FROM receipts r JOIN users u ON u.id=r.actor_id WHERE r.import_id=$1',
    [importId],
  );
  const { preview, storage_key: _key, ...safe } = b;
  return {
    ...safe,
    config: rev?.config ?? emptyConfig,
    exclusions: rev?.exclusions ?? {},
    samples,
    counts: preview?.counts,
    receipt,
  };
}
