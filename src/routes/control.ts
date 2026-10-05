import { Hono } from 'hono';
import type { AppEnv } from '../auth/identity.js';
import { meta } from '../db/meta.js';
import { createApiKey } from '../services/keys.js';
import { createBranch, createProject, listProjects } from '../services/projects.js';
import { getBranchSocket } from '../db/branch-runtime.js';

export const control = new Hono<AppEnv>();
control.get('/projects', (c) => c.json(listProjects(c.get('userId'))));
control.post('/projects', async (c) => {
  const body = await c.req.json<{ project?: { name?: string }; name?: string }>();
  const name = body.project?.name ?? body.name;
  if (!name?.trim()) return c.json({ error: 'Project name is required' }, 400);
  return c.json({ project: await createProject(c.get('userId'), name.trim()) }, 201);
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
    const branch = await createBranch(c.get('userId'), c.req.param('id'), name.trim());
    if (!branch) return c.json({ error: 'Project not found' }, 404);
    const socket = await getBranchSocket(branch.id);
    return c.json({ branch: { ...branch, connection_uri: socket.connectionString } }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Branch creation failed';
    return c.json({ error: message }, /already exists|duplicate key/i.test(message) ? 409 : 500);
  }
});
control.get('/projects/:id/endpoints', async (c) => {
  const branches = meta.prepare('SELECT id, name FROM branches WHERE project_id = ? AND project_id IN (SELECT id FROM projects WHERE owner_id = ?)').all(c.req.param('id'), c.get('userId')) as { id: string; name: string }[];
  const endpoints = await Promise.all(branches.map(async (branch) => {
    const socket = await getBranchSocket(branch.id);
    return {
      id: branch.id,
      branch_name: branch.name,
      host: '127.0.0.1',
      port: socket.port,
      database: 'postgres',
      url: `${process.env.BASE_URL ?? 'http://localhost:8787'}/sql/${branch.id}`,
      connection_uri: socket.connectionString,
    };
  }));
  return c.json(endpoints);
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
