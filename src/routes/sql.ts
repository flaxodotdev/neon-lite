import { Hono, type Context } from 'hono';
import type { AppEnv } from '../auth/identity.js';
import Database from 'better-sqlite3';
import { meta } from '../db/meta.js';

export const sql = new Hono<AppEnv>();
sql.all('/:branchId', async (c) => {
  const branch = meta.prepare('SELECT b.db_file FROM branches b JOIN projects p ON p.id = b.project_id WHERE b.id = ? AND p.owner_id = ?').get(c.req.param('branchId'), c.get('userId')) as { db_file: string } | undefined;
  if (!branch) return c.json({ message: 'Unknown database endpoint' }, 404);
  const input = await readQuery(c);
  if (!input.query.trim()) return c.json({ message: 'query is required' }, 400);
  const db = new Database(branch.db_file, { timeout: 5000 });
  try {
    db.pragma('foreign_keys = ON');
    const statement = db.prepare(input.query);
    const rows = statement.reader ? statement.all(...(input.params as never[])) : (statement.run(...(input.params as never[])), []);
    return c.json(c.req.query('neon_lite_meta') === 'true'
      ? { rows, rowCount: rows.length, command: input.query.trim().split(/\s+/, 1)[0]?.toUpperCase() }
      : rows);
  } catch (error) {
    return c.json({ message: error instanceof Error ? error.message : 'SQL execution failed', code: 'SQLITE_ERROR' }, 400);
  } finally { db.close(); }
});
async function readQuery(c: Context<AppEnv>) {
  if ((c.req.header('content-type') ?? '').includes('application/json')) {
    const body = await c.req.json<{ query?: string; params?: unknown[] }>();
    return { query: body.query ?? c.req.query('query') ?? '', params: body.params ?? [] };
  }
  return { query: c.req.query('query') ?? '', params: [] as unknown[] };
}
