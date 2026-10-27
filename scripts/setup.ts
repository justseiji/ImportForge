import { access, writeFile, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
try {
  await access('.env');
  console.log('.env already exists; preserving your configuration.');
} catch {
  const password = `Demo-${randomBytes(12).toString('base64url')}`;
  await writeFile(
    '.env',
    `APP_MODE=local\nAPP_ORIGIN=http://localhost:5173\nPORT=3001\nDEMO_PASSWORD=${password}\n`,
  );
  console.log('Created local .env with a random demo password.');
}
const env = await readFile('.env', 'utf8');
if (!/^DEMO_PASSWORD=.{12,}$/m.test(env))
  throw new Error('Set DEMO_PASSWORD in .env to at least 12 characters.');
console.log('Run npm run dev. Sign in as owner@importforge.local using DEMO_PASSWORD from .env.');
