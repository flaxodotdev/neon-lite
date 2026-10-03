import { createHash, randomBytes } from 'node:crypto';
import { meta } from '../db/meta.js';
import { nanoid } from 'nanoid';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function createApiKey(ownerId: string, name = 'Local development') {
  const secret = `nl_${randomBytes(32).toString('base64url')}`;
  const id = nanoid();
  const createdAt = new Date().toISOString();
  meta.prepare('INSERT INTO api_keys VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, ownerId, name, digest(secret), secret.slice(0, 10), createdAt);
  // Secret is returned exactly once; only its hash is persisted.
  return { id, name, key: secret, prefix: secret.slice(0, 10), created_at: createdAt };
}
export function authenticateKey(value: string) {
  const row = meta.prepare('SELECT owner_id FROM api_keys WHERE secret_hash = ?').get(digest(value)) as { owner_id: string } | undefined;
  return row?.owner_id ?? null;
}
