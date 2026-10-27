import 'dotenv/config';
import { connect, migrate } from './db.ts';
import { seed } from './seed.ts';
import { storage } from './storage.ts';
import { createServer } from './server.ts';
import { startLocalWorker } from './jobs.ts';
const db = await connect();
if (db.local) {
  await migrate(db);
  await seed(db);
}
const store = storage(),
  app = await createServer(db, store);
const stop = db.local ? startLocalWorker(db, store) : async () => {};
await app.listen({ port: Number(process.env.PORT ?? 3001), host: '0.0.0.0' });
async function close() {
  await app.close();
  await stop();
  await db.close();
  process.exit(0);
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
