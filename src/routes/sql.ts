import { Hono, type Context } from 'hono';
import type { AppEnv } from '../auth/identity.js';
import { meta } from '../db/meta.js';
import { queryBranch } from '../db/branch-runtime.js';

export const sql = new Hono<AppEnv>();
sql.all('/:branchId', async (c) => {
  const branch = meta.prepare('SELECT b.id FROM branches b JOIN projects p ON p.id = b.project_id WHERE b.id = ? AND p.owner_id = ?').get(c.req.param('branchId'), c.get('userId')) as { id: string } | undefined;
  if (!branch) return c.json({ message: 'Unknown database endpoint' }, 404);
  const input = await readQuery(c);
  if (!input.query.trim()) return c.json({ message: 'query is required' }, 400);
  try {
    const result = await queryBranch(branch.id, input.query, input.params);
    const rows = result.rows;
    return c.json(c.req.query('neon_lite_meta') === 'true'
      ? { rows, rowCount: result.affectedRows ?? rows.length, command: input.query.trim().split(/\s+/, 1)[0]?.toUpperCase() }
      : rows);
  } catch (error) {
    const pgError = error as Error & { code?: string };
    return c.json({ message: pgError.message || 'SQL execution failed', code: pgError.code ?? 'POSTGRES_ERROR' }, 400);
  }
});
async function readQuery(c: Context<AppEnv>) {
  if ((c.req.header('content-type') ?? '').includes('application/json')) {
    const body = await c.req.json<{ query?: string; params?: unknown[] }>();
    return { query: body.query ?? c.req.query('query') ?? '', params: body.params ?? [] };
  }
  return { query: c.req.query('query') ?? '', params: [] as unknown[] };
}
