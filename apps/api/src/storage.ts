import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
export interface Storage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
export function storage(): Storage {
  if (process.env.APP_MODE !== 'production')
    return {
      async put(key, data) {
        await mkdir('.data/objects', { recursive: true });
        await writeFile(join('.data/objects', key), data, { flag: 'wx' });
      },
      get: (key) => readFile(join('.data/objects', key)),
      remove: (key) => unlink(join('.data/objects', key)),
    };
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
  const Bucket = process.env.S3_BUCKET!;
  return {
    async put(Key, Body) {
      await client.send(
        new PutObjectCommand({ Bucket, Key, Body, ContentType: 'text/csv', IfNoneMatch: '*' }),
      );
    },
    async get(Key) {
      const result = await client.send(new GetObjectCommand({ Bucket, Key }));
      return Buffer.from(await result.Body!.transformToByteArray());
    },
    async remove(Key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key }));
    },
  };
}
