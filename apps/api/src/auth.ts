import { randomBytes, createHash } from 'node:crypto';
import { verify, hash } from '@node-rs/argon2';
import type { Sql } from './db.ts';
export type Actor = {
  userId: string;
  workspaceId: string;
  role: 'owner' | 'editor' | 'viewer';
  name: string;
  email: string;
};
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export const passwordHash = (password: string) =>
  hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
export async function login(db: Sql, email: string, password: string) {
  const [user] = await db.query('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
  if (!user || !(await verify(user.password_hash, password)))
    throw new AppError(401, 'LOGIN_FAILED', 'Email or password is incorrect.');
  const [member] = await db.query(
    'SELECT * FROM memberships WHERE user_id=$1 ORDER BY workspace_id LIMIT 1',
    [user.id],
  );
  if (!member) throw new AppError(403, 'NO_WORKSPACE', 'No workspace membership.');
  const token = randomBytes(32).toString('base64url');
  await db.query(
    "INSERT INTO sessions(digest,user_id,workspace_id,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')",
    [digest(token), user.id, member.workspace_id],
  );
  return token;
}
export async function authenticate(db: Sql, token?: string): Promise<Actor> {
  if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in.');
  const [s] = await db.query(
    'SELECT u.id,u.name,u.email,s.workspace_id,m.role FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.user_id=s.user_id AND m.workspace_id=s.workspace_id WHERE s.digest=$1 AND s.expires_at>now()',
    [digest(token)],
  );
  if (!s) throw new AppError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in.');
  return { userId: s.id, workspaceId: s.workspace_id, role: s.role, name: s.name, email: s.email };
}
export function requireRole(actor: Actor, role: 'editor' | 'owner') {
  if (actor.role === 'viewer' || (role === 'owner' && actor.role !== 'owner'))
    throw new AppError(403, 'FORBIDDEN', `This action requires ${role} access.`);
}
