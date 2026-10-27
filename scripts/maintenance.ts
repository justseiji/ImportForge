import 'dotenv/config';
import { readdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { connect } from '../apps/api/src/db.ts';
import { storage } from '../apps/api/src/storage.ts';
// Dry-run by default. Only generated, unreferenced object IDs older than 24h qualify.
const apply = process.argv.includes('--apply'),
  db = await connect(),
  store = storage();
const referenced = new Set(
  (await db.query('SELECT storage_key FROM sources')).map((r) => r.storage_key),
);
const candidates: { key: string; modified: Date }[] = [];
if (db.local) {
  const root = resolve('.data/objects');
  for (const key of await readdir(root).catch(() => [])) {
    const path = resolve(root, key);
    if (dirname(path) !== root) throw new Error('Object escaped storage root');
    const info = await stat(path);
    if (info.isFile()) candidates.push({ key, modified: info.mtime });
  }
} else {
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, ContinuationToken: token }),
    );
    for (const object of page.Contents ?? [])
      if (object.Key && object.LastModified)
        candidates.push({ key: object.Key, modified: object.LastModified });
    token = page.NextContinuationToken;
  } while (token);
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
let eligible = 0;
for (const object of candidates)
  if (
    uuid.test(object.key) &&
    !referenced.has(object.key) &&
    object.modified.getTime() < Date.now() - 86400000
  ) {
    eligible++;
    if (apply) await store.remove(object.key);
  }
const [sessions] = await db.query('SELECT count(*)::int AS n FROM sessions WHERE expires_at<now()');
if (apply) await db.query('DELETE FROM sessions WHERE expires_at<now()');
console.log(
  JSON.stringify({
    mode: apply ? 'applied' : 'dry-run',
    orphanObjects: eligible,
    expiredSessions: sessions.n,
  }),
);
await db.close();
