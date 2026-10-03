import { Hono } from 'hono';
import type { AppEnv } from '../auth/identity.js';
import { meta } from '../db/meta.js';
import { createApiKey } from '../services/keys.js';
import { createBranch, createProject, listProjects } from '../services/projects.js';

export const control = new Hono<AppEnv>();
control.get('/projects', (c) => c.json(listProjects(c.get('userId'))));
control.post('/projects', async (c) => {
  const body = await c.req.json<{ project?: { name?: string }; name?: string }>();
  const name = body.project?.name ?? body.name;
  if (!name?.trim()) return c.json({ error: 'Project name is required' }, 400);
  return c.json({ project: createProject(c.get('userId'), name.trim()) }, 201);
});
control.get('/projects/:id/branches', (c) => {
  const rows = meta.prepare('SELECT id, project_id, name, created_at FROM branches WHERE project_id = ? AND project_id IN (SELECT id FROM projects WHERE owner_id = ?)').all(c.req.param('id'), c.get('userId'));
  return c.json(rows);
});
control.post('/projects/:id/branches', async (c) => {
  const body = await c.req.json<{ branch?: { name?: string }; name?: string }>();
  const name = body.branch?.name ?? body.name;
  if (!name?.trim()) return c.json({ error: 'Branch name is required' }, 400);
  try {
    const branch = createBranch(c.get('userId'), c.req.param('id'), name.trim());
    return branch ? c.json({ branch }, 201) : c.json({ error: 'Project not found' }, 404);
  } catch { return c.json({ error: 'Branch already exists or could not be created' }, 409); }
});
control.get('/projects/:id/endpoints', (c) => {
  const branches = meta.prepare('SELECT id, name FROM branches WHERE project_id = ? AND project_id IN (SELECT id FROM projects WHERE owner_id = ?)').all(c.req.param('id'), c.get('userId')) as { id: string; name: string }[];
  return c.json(branches.map((b) => ({ id: b.id, branch_name: b.name, host: 'localhost', port: Number(process.env.PORT ?? 8787), database: 'main', url: `${process.env.BASE_URL ?? 'http://localhost:8787'}/sql/${b.id}` })));
});
control.post('/api-keys', async (c) => {
  const body = await c.req.json<{ name?: string }>().catch((): { name?: string } => ({}));
  return c.json({ api_key: createApiKey(c.get('userId'), body.name) }, 201);
});
control.get('/api-keys', (c) => c.json(meta.prepare('SELECT id, name, prefix, created_at FROM api_keys WHERE owner_id = ?').all(c.get('userId'))));
control.delete('/api-keys/:id', (c) => {
  const result = meta.prepare('DELETE FROM api_keys WHERE id = ? AND owner_id = ?').run(c.req.param('id'), c.get('userId'));
  return result.changes ? c.body(null, 204) : c.json({ error: 'API key not found' }, 404);
});
