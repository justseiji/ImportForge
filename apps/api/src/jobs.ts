import type { Database } from './db.ts';
import type { Storage } from './storage.ts';
import { executeCommit, executeParse, executePrepare } from './imports.ts';
import { executeSuggest } from './ai.ts';
import { AppError } from './auth.ts';
import { ImportError } from '@importforge/import-engine';
const log = (event: string, j: any, extra: Record<string, unknown> = {}) => {
  if (process.env.NODE_ENV !== 'test')
    console.log(
      JSON.stringify({
        event,
        jobId: j.id,
        importId: j.import_id,
        workspaceId: j.workspace_id,
        revision: j.revision,
        attempt: j.attempts,
        ...extra,
      }),
    );
};
export async function runJob(db: Database, store: Storage, jobId?: string) {
  const [j] = await db.query(
    `UPDATE jobs SET status='running',attempts=attempts+1,lease_until=now()+interval '10 minutes' WHERE id=(SELECT id FROM jobs WHERE (status='pending' AND available_at<=now() OR status='running' AND lease_until<now()) ${jobId ? 'AND id=$1' : ''} ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
    jobId ? [jobId] : [],
  );
  if (!j) return false;
  log('job-started', j);
  try {
    if (j.kind === 'parse') await executeParse(db, store, j);
    if (j.kind === 'prepare') await executePrepare(db, j);
    if (j.kind === 'commit') await executeCommit(db, j);
    if (j.kind === 'suggest') await executeSuggest(db, j);
    await db.query("UPDATE jobs SET status='done',lease_until=NULL WHERE id=$1", [j.id]);
    log('job-completed', j);
  } catch (error) {
    const terminal = error instanceof AppError || error instanceof ImportError || j.attempts >= 3;
    log(terminal ? 'job-failed' : 'job-retry', j, {
      code: error instanceof AppError || error instanceof ImportError ? error.code : 'TRANSIENT',
    });
    const message =
      error instanceof AppError || error instanceof ImportError
        ? error.message
        : 'Processing failed. Retry preparation; contact the workspace owner if it persists.';
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE jobs SET status=$1,error=$2,lease_until=NULL,available_at=now()+interval '5 seconds' WHERE id=$3",
        [terminal ? 'failed' : 'pending', message, j.id],
      );
      if (terminal) {
        await tx.query(
          "UPDATE imports SET status='failed',error=$1,updated_at=now() WHERE id=$2 AND revision=$3 AND status<>'completed'",
          [message, j.import_id, j.revision],
        );
        if (j.kind === 'commit')
          await tx.query("UPDATE commit_attempts SET status='failed',error=$1 WHERE id=$2", [
            message,
            j.payload.attemptId,
          ]);
      }
    });
  }
  return true;
}
export function startLocalWorker(db: Database, store: Storage) {
  let stopped = false;
  let current: Promise<unknown> = Promise.resolve();
  const timer = setInterval(() => {
    if (stopped) return;
    stopped = true;
    current = runJob(db, store)
      .catch(() => console.error(JSON.stringify({ event: 'local-worker-poll-failed' })))
      .finally(() => {
        stopped = false;
      });
  }, 300);
  return async () => {
    clearInterval(timer);
    await current;
  };
}
