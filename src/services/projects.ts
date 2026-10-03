import Database from 'better-sqlite3';
import { existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { dataDir, meta } from '../db/meta.js';

export function createProject(ownerId: string, name: string) {
  const id = nanoid();
  const branchId = nanoid();
  const dbFile = join(dataDir, `${branchId}.sqlite`);
  const now = new Date().toISOString();
  const tx = meta.transaction(() => {
    meta.prepare('INSERT INTO projects VALUES (?, ?, ?, ?)').run(id, ownerId, name, now);
    meta.prepare('INSERT INTO branches VALUES (?, ?, ?, ?, ?)').run(branchId, id, 'main', dbFile, now);
  });
  tx();
  new Database(dbFile).close();
  return { id, name, created_at: now, branches: [{ id: branchId, name: 'main' }] };
}
export function createBranch(ownerId: string, projectId: string, name: string) {
  const source = meta.prepare('SELECT db_file FROM branches WHERE project_id = ? AND name = ? AND project_id IN (SELECT id FROM projects WHERE owner_id = ?)').get(projectId, 'main', ownerId) as { db_file: string } | undefined;
  if (!source) return null;
  const id = nanoid();
  const dbFile = join(dataDir, `${id}.sqlite`);
  if (existsSync(source.db_file)) copyFileSync(source.db_file, dbFile);
  new Database(dbFile).close();
  const createdAt = new Date().toISOString();
  meta.prepare('INSERT INTO branches VALUES (?, ?, ?, ?, ?)').run(id, projectId, name, dbFile, createdAt);
  return { id, project_id: projectId, name, created_at: createdAt };
}
export function getBranch(projectId: string, branchId: string) {
  return meta.prepare('SELECT * FROM branches WHERE project_id = ? AND id = ?').get(projectId, branchId) as { id: string; project_id: string; name: string; db_file: string } | undefined;
}
export function listProjects(ownerId: string) {
  return meta.prepare('SELECT id, name, created_at FROM projects WHERE owner_id = ? ORDER BY created_at DESC').all(ownerId);
}
