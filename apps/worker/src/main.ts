import 'dotenv/config';
import { Queue, Worker } from 'bullmq';
import { connect } from '../../api/src/db.ts';
import { storage } from '../../api/src/storage.ts';
import { runJob } from '../../api/src/jobs.ts';
if (process.env.APP_MODE !== 'production')
  throw new Error(
    'Local mode runs its worker inside the API. Use APP_MODE=production for separate workers.',
  );
const db = await connect(),
  store = storage();
const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
const connection = {
  host: url.hostname,
  port: Number(url.port || 6379),
  password: url.password || undefined,
  maxRetriesPerRequest: null,
};
const queue = new Queue('importforge', { connection });
const worker = new Worker(
  'importforge',
  async (job) => {
    await runJob(db, store, job.data.id);
  },
  { connection, concurrency: 2 },
);
worker.on('error', (error) =>
  console.error(JSON.stringify({ event: 'worker-error', message: error.message })),
);
let publishing = false;
const timer = setInterval(async () => {
  if (publishing) return;
  publishing = true;
  try {
    const jobs = await db.query(
      "SELECT id,workspace_id,import_id FROM jobs WHERE status='pending' AND available_at<=now() OR status='running' AND lease_until<now() ORDER BY created_at LIMIT 100",
    );
    for (const j of jobs)
      await queue.add(
        'execute',
        { id: j.id },
        {
          jobId: `${j.id}-${Date.now()}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      );
  } catch {
    console.error(JSON.stringify({ event: 'dispatch-failed' }));
  } finally {
    publishing = false;
  }
}, 2000);
async function close() {
  clearInterval(timer);
  await worker.close();
  await queue.close();
  await db.close();
  process.exit(0);
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
console.log('ImportForge worker started; DB outbox dispatch every 2 seconds.');
