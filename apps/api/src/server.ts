import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import {
  allowedSchema,
  commitSchema,
  configSchema,
  loginSchema,
  prepareSchema,
  supplierSchema,
  type Preview,
} from '@importforge/contracts';
import { csvCell, validateMapping, ImportError } from '@importforge/import-engine';
import { type Database, json, lock } from './db.ts';
import { authenticate, AppError, digest, login, requireRole, type Actor } from './auth.ts';
import { batch, detail, id, job, prepare, requestCommit, upload } from './imports.ts';
import type { Storage } from './storage.ts';
declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor;
  }
}
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  q: z.string().max(200).default(''),
  status: z.string().max(30).default(''),
  kind: z.string().max(30).default(''),
  supplier: z.string().max(100).default(''),
  sort: z.enum(['name', 'sku', 'price', 'updated']).default('name'),
});
export async function createServer(db: Database, store: Storage, logging = true) {
  const app = Fastify({
    logger: logging
      ? { redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers.set-cookie'] }
      : false,
    bodyLimit: 1024 * 1024,
  });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 2 } });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  app.decorateRequest('actor');
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: {
          code: 'VALIDATION',
          message: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          requestId: req.id,
        },
      });
    const e = error as any;
    const status =
      e instanceof AppError
        ? e.status
        : e instanceof ImportError
          ? 422
          : e.code === '23505'
            ? 409
            : (e.statusCode ?? 500);
    if (status >= 500)
      req.log.error({ requestId: req.id, code: e.code ?? 'INTERNAL' }, 'Request failed');
    return reply.code(status).send({
      error: {
        code: e.code ?? 'INTERNAL',
        message: status >= 500 ? 'An unexpected error occurred. Try again.' : e.message,
        requestId: req.id,
      },
    });
  });
  app.addHook('preHandler', async (req) => {
    const path = req.url.split('?')[0];
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin !== (process.env.APP_ORIGIN ?? 'http://localhost:5173'))
        throw new AppError(403, 'ORIGIN', 'Request origin is not allowed.');
    }
    if (!['/api/auth/login', '/api/health', '/api/ready'].includes(path))
      req.actor = await authenticate(db, req.cookies.session);
  });
  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/ready', async () => {
    await db.query('SELECT 1');
    return { status: 'ready', mode: db.local ? 'local' : 'production' };
  });
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = loginSchema.parse(req.body);
      const token = await login(db, body.email, body.password);
      reply.setCookie('session', token, {
        httpOnly: true,
        secure: process.env.APP_MODE === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 43200,
      });
      return { ok: true };
    },
  );
  app.post('/api/auth/logout', async (req, reply) => {
    await db.query('DELETE FROM sessions WHERE digest=$1', [digest(req.cookies.session!)]);
    reply.clearCookie('session', { path: '/' });
    return { ok: true };
  });
  app.get('/api/session', async (req) => {
    const [workspace] = await db.query('SELECT * FROM workspaces WHERE id=$1', [
      req.actor.workspaceId,
    ]);
    return {
      user: req.actor,
      workspace,
      mode: db.local ? 'local' : 'production',
      aiAvailable: !!process.env.AI_API_KEY,
    };
  });
  app.get('/api/imports', async (req) => {
    const p = pageSchema.parse(req.query),
      params = [req.actor.workspaceId, `%${p.q}%`, p.status];
    const where =
      "i.workspace_id=$1 AND (s.filename ILIKE $2 OR sp.name ILIKE $2) AND ($3='' OR i.status=$3)";
    const [count] = await db.query(
      `SELECT count(*)::int AS total FROM imports i JOIN sources s ON s.id=i.source_id JOIN suppliers sp ON sp.id=i.supplier_id WHERE ${where}`,
      params,
    );
    const items = await db.query(
      `SELECT i.id,i.status,i.row_count,i.updated_at,i.error,i.preview->'counts' AS counts,s.filename,sp.name AS supplier_name,u.name AS owner FROM imports i JOIN sources s ON s.id=i.source_id JOIN suppliers sp ON sp.id=i.supplier_id JOIN users u ON u.id=i.created_by WHERE ${where} ORDER BY i.updated_at DESC,i.id LIMIT 25 OFFSET $4`,
      [...params, (p.page - 1) * 25],
    );
    const [stats] = await db.query(
      "SELECT count(*)::int AS total,count(*) FILTER(WHERE status IN ('mapping','review','failed'))::int AS attention,count(*) FILTER(WHERE status='completed')::int AS completed FROM imports WHERE workspace_id=$1",
      [req.actor.workspaceId],
    );
    return { items, total: count.total, page: p.page, pageSize: 25, stats };
  });
  app.post('/api/imports', async (req, reply) => {
    requireRole(req.actor, 'editor');
    let supplierId = '',
      filename = '',
      bytes: Buffer | undefined;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        filename = part.filename;
        bytes = await part.toBuffer();
        if (part.file.truncated) throw new AppError(413, 'FILE_LIMIT', 'File exceeds 20 MiB.');
      } else if (part.fieldname === 'supplierId') supplierId = String(part.value);
    }
    if (!bytes || !filename.toLowerCase().endsWith('.csv'))
      throw new AppError(400, 'CSV_REQUIRED', 'Select a .csv file.');
    const result = await upload(db, store, req.actor, supplierId, filename, bytes);
    return reply.code(202).send(result);
  });
  app.get<{ Params: { id: string } }>('/api/imports/:id', async (req) =>
    detail(db, req.actor, req.params.id),
  );
  app.get<{ Params: { id: string } }>('/api/imports/:id/rows', async (req) => {
    const p = pageSchema.parse(req.query),
      b = await batch(db, req.actor.workspaceId, req.params.id);
    const preview = b.preview as Preview | null;
    if (preview) {
      const rows = preview.rows.filter((r) => !p.kind || r.kind === p.kind);
      return {
        items: rows.slice((p.page - 1) * 25, p.page * 25),
        total: rows.length,
        page: p.page,
        pageSize: 25,
      };
    }
    const rows = await db.query(
      'SELECT ordinal AS record,values AS source FROM source_rows WHERE import_id=$1 ORDER BY ordinal LIMIT 25 OFFSET $2',
      [b.id, (p.page - 1) * 25],
    );
    return { items: rows, total: b.row_count ?? 0, page: p.page, pageSize: 25 };
  });
  app.post<{ Params: { id: string } }>('/api/imports/:id/prepare', async (req, reply) =>
    reply
      .code(202)
      .send(await prepare(db, req.actor, req.params.id, prepareSchema.parse(req.body))),
  );
  app.post<{ Params: { id: string } }>('/api/imports/:id/commit', async (req, reply) => {
    const input = commitSchema.parse(req.body);
    return reply
      .code(202)
      .send(
        await requestCommit(db, req.actor, req.params.id, input.revision, input.idempotencyKey),
      );
  });
  app.post<{ Params: { id: string } }>('/api/imports/:id/suggest', async (req, reply) => {
    requireRole(req.actor, 'editor');
    const input = z.object({ consent: z.boolean() }).parse(req.body);
    const b = await batch(db, req.actor.workspaceId, req.params.id);
    if (!b.headers.length) throw new AppError(409, 'NOT_PARSED', 'Wait for parsing to finish.');
    const [recent] = await db.query(
      "SELECT count(*)::int AS n FROM jobs WHERE workspace_id=$1 AND kind='suggest' AND created_at>now()-interval '1 minute'",
      [req.actor.workspaceId],
    );
    if (recent.n >= 5)
      throw new AppError(429, 'AI_RATE_LIMIT', 'Wait a minute before requesting more suggestions.');
    await job(db, req.actor, b.id, 'suggest', b.revision, input);
    return reply.code(202).send({ queued: true });
  });
  app.get<{ Params: { id: string } }>('/api/imports/:id/source', async (req, reply) => {
    const b = await batch(db, req.actor.workspaceId, req.params.id);
    return reply
      .header('Content-Disposition', 'attachment; filename="source.csv"')
      .type('text/csv')
      .send(await store.get(b.storage_key));
  });
  app.get<{ Params: { id: string } }>('/api/imports/:id/report', async (req, reply) => {
    const b = await batch(db, req.actor.workspaceId, req.params.id);
    if (b.status !== 'completed')
      throw new AppError(409, 'NO_RECEIPT', 'A completed import is required.');
    const preview = b.preview as Preview;
    const csv = [
      ['Record', 'SKU', 'Outcome', 'Reason', 'Changes'],
      ...preview.rows.map((r) => [
        r.record,
        r.values.sku,
        r.kind,
        r.reason ?? '',
        JSON.stringify(r.changes),
      ]),
    ]
      .map((r) => r.map(csvCell).join(','))
      .join('\r\n');
    return reply
      .header('Content-Disposition', 'attachment; filename="import-receipt.csv"')
      .type('text/csv')
      .send(csv);
  });
  app.get('/api/catalog', async (req) => {
    const p = pageSchema.parse(req.query);
    const ordering = {
      name: 'p.name',
      sku: 'p.sku',
      price: 'p.price',
      updated: 'p.updated_at DESC',
    }[p.sort];
    const params = [req.actor.workspaceId, `%${p.q}%`, p.supplier];
    const where =
      "p.workspace_id=$1 AND (p.name ILIKE $2 OR p.sku ILIKE $2) AND ($3='' OR p.supplier_id=$3)";
    const [count] = await db.query(
      `SELECT count(*)::int AS total FROM products p WHERE ${where}`,
      params,
    );
    const items = await db.query(
      `SELECT p.*,p.price::text AS price,s.name AS supplier_name FROM products p JOIN suppliers s ON s.id=p.supplier_id WHERE ${where} ORDER BY ${ordering},p.id LIMIT 25 OFFSET $4`,
      [...params, (p.page - 1) * 25],
    );
    return { items, total: count.total, page: p.page, pageSize: 25 };
  });
  app.get('/api/catalog/export', async (req, reply) => {
    const rows = await db.query(
      'SELECT p.sku,p.name,p.description,p.category,p.price::text,p.currency,p.unit,p.active,s.name AS supplier FROM products p JOIN suppliers s ON s.id=p.supplier_id WHERE p.workspace_id=$1 ORDER BY s.name,p.sku',
      [req.actor.workspaceId],
    );
    const headers = [
      'supplier',
      'sku',
      'name',
      'description',
      'category',
      'price',
      'currency',
      'unit',
      'active',
    ];
    const csv = [headers, ...rows.map((r) => headers.map((h) => r[h]))]
      .map((r) => r.map(csvCell).join(','))
      .join('\r\n');
    return reply
      .header('Content-Disposition', 'attachment; filename="catalog.csv"')
      .type('text/csv')
      .send(csv);
  });
  app.get<{ Params: { id: string } }>('/api/catalog/:id', async (req) => {
    const [product] = await db.query(
      'SELECT p.*,p.price::text AS price,s.name AS supplier_name FROM products p JOIN suppliers s ON s.id=p.supplier_id WHERE p.id=$1 AND p.workspace_id=$2',
      [req.params.id, req.actor.workspaceId],
    );
    if (!product) throw new AppError(404, 'NOT_FOUND', 'Product not found.');
    const history = await db.query(
      'SELECT a.*,u.name AS actor,s.filename FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN imports i ON i.id=a.import_id LEFT JOIN sources s ON s.id=i.source_id WHERE a.product_id=$1 AND a.workspace_id=$2 ORDER BY a.created_at DESC',
      [product.id, req.actor.workspaceId],
    );
    return { product, history };
  });
  app.get('/api/suppliers', async (req) => ({
    items: await db.query(
      'SELECT s.*,(SELECT count(*)::int FROM products p WHERE p.supplier_id=s.id AND p.workspace_id=s.workspace_id) AS products,(SELECT max(version) FROM saved_mappings m WHERE m.supplier_id=s.id) AS mapping_version FROM suppliers s WHERE workspace_id=$1 ORDER BY name',
      [req.actor.workspaceId],
    ),
  }));
  app.post('/api/suppliers', async (req) => {
    requireRole(req.actor, 'editor');
    const input = supplierSchema.parse(req.body);
    const [supplier] = await db.query(
      'INSERT INTO suppliers(id,workspace_id,name,contact) VALUES($1,$2,$3,$4) RETURNING *',
      [id(), req.actor.workspaceId, input.name, input.contact],
    );
    return supplier;
  });
  app.get<{ Params: { id: string } }>('/api/suppliers/:id/mappings', async (req) => ({
    items: await db.query(
      'SELECT * FROM saved_mappings WHERE supplier_id=$1 AND workspace_id=$2 ORDER BY version DESC',
      [req.params.id, req.actor.workspaceId],
    ),
  }));
  app.post<{ Params: { id: string } }>('/api/suppliers/:id/mappings', async (req) => {
    requireRole(req.actor, 'editor');
    const input = z
      .object({ headers: z.array(z.string()).max(100), config: configSchema })
      .parse(req.body);
    validateMapping(input.headers, input.config);
    return db.transaction(async (tx) => {
      await lock(tx, req.actor.workspaceId);
      if (
        !(
          await tx.query('SELECT id FROM suppliers WHERE id=$1 AND workspace_id=$2', [
            req.params.id,
            req.actor.workspaceId,
          ])
        ).length
      )
        throw new AppError(404, 'NOT_FOUND', 'Supplier not found.');
      const [last] = await tx.query(
        'SELECT coalesce(max(version),0)::int AS v FROM saved_mappings WHERE supplier_id=$1',
        [req.params.id],
      );
      const [saved] = await tx.query(
        'INSERT INTO saved_mappings(id,workspace_id,supplier_id,version,headers,config) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb) RETURNING *',
        [
          id(),
          req.actor.workspaceId,
          req.params.id,
          last.v + 1,
          json(input.headers),
          json(input.config),
        ],
      );
      return saved;
    });
  });
  app.get('/api/settings', async (req) => {
    const [w] = await db.query('SELECT * FROM workspaces WHERE id=$1', [req.actor.workspaceId]);
    return w;
  });
  app.put('/api/settings', async (req) => {
    requireRole(req.actor, 'owner');
    const allowed = allowedSchema.parse(req.body);
    await db.transaction(async (tx) => {
      await lock(tx, req.actor.workspaceId);
      await tx.query('UPDATE workspaces SET allowed=$1::jsonb WHERE id=$2', [
        json(allowed),
        req.actor.workspaceId,
      ]);
      await tx.query(
        'INSERT INTO audit_events(id,workspace_id,actor_id,kind,detail) VALUES($1,$2,$3,$4,$5::jsonb)',
        [id(), req.actor.workspaceId, req.actor.userId, 'settings', json(allowed)],
      );
    });
    return { ok: true };
  });
  app.get('/api/members', async (req) => ({
    items: await db.query(
      'SELECT u.id,u.name,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY u.name',
      [req.actor.workspaceId],
    ),
  }));
  app.patch<{ Params: { id: string } }>('/api/members/:id', async (req) => {
    requireRole(req.actor, 'owner');
    const { role } = z.object({ role: z.enum(['owner', 'editor', 'viewer']) }).parse(req.body);
    await db.transaction(async (tx) => {
      await lock(tx, req.actor.workspaceId);
      const members = await tx.query('SELECT * FROM memberships WHERE workspace_id=$1', [
        req.actor.workspaceId,
      ]);
      const target = members.find((m) => m.user_id === req.params.id);
      if (!target) throw new AppError(404, 'NOT_FOUND', 'Member not found.');
      if (
        target.role === 'owner' &&
        role !== 'owner' &&
        members.filter((m) => m.role === 'owner').length === 1
      )
        throw new AppError(409, 'LAST_OWNER', 'A workspace must retain an owner.');
      await tx.query('UPDATE memberships SET role=$1 WHERE workspace_id=$2 AND user_id=$3', [
        role,
        req.actor.workspaceId,
        req.params.id,
      ]);
      await tx.query(
        'INSERT INTO audit_events(id,workspace_id,actor_id,kind,detail) VALUES($1,$2,$3,$4,$5::jsonb)',
        [
          id(),
          req.actor.workspaceId,
          req.actor.userId,
          'membership',
          json({ userId: req.params.id, before: target.role, after: role }),
        ],
      );
    });
    return { ok: true };
  });
  return app;
}
