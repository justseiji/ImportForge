import 'dotenv/config';
import { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFile, mkdir } from 'node:fs/promises';
export interface Sql {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
}
export interface Database extends Sql {
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  local: boolean;
}
export async function connect(memory = false): Promise<Database> {
  if (process.env.APP_MODE !== 'production' || memory) {
    if (!memory) await mkdir('.data', { recursive: true });
    const pg = new PGlite(memory ? undefined : '.data/postgres');
    await pg.waitReady;
    const adapter = (conn: any): Sql => ({
      query: async <T>(sql: string, params: unknown[] = []) =>
        (await conn.query(sql, params)).rows as T[],
    });
    return {
      ...adapter(pg),
      transaction: (fn) => pg.transaction((tx) => fn(adapter(tx))),
      close: () => pg.close(),
      local: true,
    };
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  await prisma.$connect();
  const adapter = (client: any): Sql => ({
    query: <T>(sql: string, params: unknown[] = []) =>
      client.$queryRawUnsafe(sql, ...params) as Promise<T[]>,
  });
  return {
    ...adapter(prisma),
    transaction: (fn) =>
      prisma.$transaction((tx) => fn(adapter(tx)), { timeout: 120000, maxWait: 10000 }),
    close: () => prisma.$disconnect(),
    local: false,
  };
}
export async function migrate(db: Database) {
  const sql = await readFile(
    new URL('../../../prisma/migrations/001_initial/migration.sql', import.meta.url),
    'utf8',
  );
  await db.transaction(async (tx) => {
    for (const statement of sql.split(';').filter((s) => s.trim())) await tx.query(statement);
  });
}
export async function lock(tx: Sql, workspace: string) {
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))::text', [workspace]);
}
export const json = (v: unknown) => JSON.stringify(v);
