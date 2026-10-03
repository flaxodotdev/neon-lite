import type { Context, Next } from 'hono';
import { auth } from './auth.js';
import { authenticateKey } from '../services/keys.js';

export type AppEnv = { Variables: { userId: string } };
export async function requireIdentity(c: Context<AppEnv>, next: Next) {
  const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? c.req.header('x-api-key');
  const apiOwner = bearer?.startsWith('nl_') ? authenticateKey(bearer) : null;
  const session = apiOwner ? null : await auth.api.getSession({ headers: c.req.raw.headers });
  const userId = apiOwner ?? session?.user.id;
  if (!userId) return c.json({ error: 'Authentication required' }, 401);
  c.set('userId', userId);
  await next();
}
