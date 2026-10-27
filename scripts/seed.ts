import { connect, migrate } from '../apps/api/src/db.ts';
import { seed } from '../apps/api/src/seed.ts';
const db = await connect();
await migrate(db);
await seed(db);
await db.close();
console.log(
  'Seed complete. Accounts: owner@importforge.local, editor@importforge.local, viewer@importforge.local.',
);
