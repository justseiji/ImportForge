import { connect, migrate } from '../apps/api/src/db.ts';
const db = await connect();
await migrate(db);
await db.close();
console.log('Database migration complete.');
