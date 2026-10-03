import { Hono } from 'hono';
import type { AppEnv } from '../auth/identity.js';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { dataDir } from '../db/meta.js';

export const storage = new Hono<AppEnv>();
const root = resolve(dataDir, 'objects');
mkdirSync(root, { recursive: true });
storage.put('/:key{.+}', async (c) => {
  const key = safeKey(c.req.param('key'));
  if (!key) return c.json({ error: 'Invalid object key' }, 400);
  const path = resolve(root, key);
  mkdirSync(resolve(path, '..'), { recursive: true });
  const bytes = await c.req.arrayBuffer();
  await writeFile(path, new Uint8Array(bytes));
  return c.json({ key, size: bytes.byteLength }, 201);
});
storage.get('/:key{.+}', async (c) => {
  const key = safeKey(c.req.param('key'));
  const path = key ? resolve(root, key) : '';
  if (!key || !path.startsWith(`${root}/`)) return c.json({ error: 'Invalid object key' }, 400);
  try { return c.body(new Uint8Array(await readFile(path))); } catch { return c.json({ error: 'Object not found' }, 404); }
});
storage.delete('/:key{.+}', async (c) => {
  const key = safeKey(c.req.param('key'));
  if (!key) return c.json({ error: 'Invalid object key' }, 400);
  try { await unlink(resolve(root, key)); return c.body(null, 204); }
  catch { return c.json({ error: 'Object not found' }, 404); }
});
function safeKey(value: string) {
  const normalized = value.split('/').filter((part) => part && part !== '.' && part !== '..').join('/');
  return normalized && basename(normalized) !== '.' ? normalized : null;
}
