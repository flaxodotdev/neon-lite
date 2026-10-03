import { Hono } from 'hono';
import type { AppEnv } from '../auth/identity.js';
import { nanoid } from 'nanoid';
import { runInNewContext } from 'node:vm';
import { meta } from '../db/meta.js';

export const functions = new Hono<AppEnv>();
functions.get('/', (c) => c.json(meta.prepare('SELECT id, project_id, name, created_at FROM functions WHERE project_id = ? AND project_id IN (SELECT id FROM projects WHERE owner_id = ?)').all(c.req.query('project_id') ?? '', c.get('userId'))));
functions.post('/', async (c) => {
  const body = await c.req.json<{ project_id?: string; name?: string; source?: string }>();
  if (!body.project_id || !body.name || !body.source) return c.json({ error: 'project_id, name and source are required' }, 400);
  const ownsProject = meta.prepare('SELECT 1 FROM projects WHERE id = ? AND owner_id = ?').get(body.project_id, c.get('userId'));
  if (!ownsProject) return c.json({ error: 'Project not found' }, 404);
  const id = nanoid();
  try {
    meta.prepare('INSERT INTO functions VALUES (?, ?, ?, ?, ?)').run(id, body.project_id, body.name, body.source, new Date().toISOString());
    return c.json({ id, project_id: body.project_id, name: body.name }, 201);
  } catch { return c.json({ error: 'Project missing or function name already used' }, 409); }
});
functions.post('/:id/invoke', async (c) => {
  const fn = meta.prepare('SELECT source FROM functions f JOIN projects p ON p.id = f.project_id WHERE f.id = ? AND p.owner_id = ?').get(c.req.param('id'), c.get('userId')) as { source: string } | undefined;
  if (!fn) return c.json({ error: 'Function not found' }, 404);
  const input = await c.req.json().catch(() => ({}));
  try {
    const result = runInNewContext(`(async (input) => { ${fn.source}\n })(input)`, { input }, { timeout: 1000 });
    return c.json({ result: await Promise.resolve(result) });
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Function failed' }, 500); }
});
