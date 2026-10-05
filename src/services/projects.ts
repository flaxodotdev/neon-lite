import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { dataDir, meta } from '../db/meta.js';
import { createSnapshotBranch, getBranchDatabase } from '../db/branch-runtime.js';

export async function createProject(ownerId: string, name: string) {
  const id = nanoid();
  const branchId = nanoid();
  const dbFile = join(dataDir, 'branches', branchId);
  await mkdir(join(dataDir, 'branches'), { recursive: true });
  const now = new Date().toISOString();
  const tx = meta.transaction(() => {
    meta.prepare('INSERT INTO projects VALUES (?, ?, ?, ?)').run(id, ownerId, name, now);
    meta.prepare("INSERT INTO branches (id, project_id, name, db_file, created_at, db_kind) VALUES (?, ?, 'main', ?, ?, 'pglite')").run(branchId, id, dbFile, now);
  });
  tx();
  try { await getBranchDatabase(branchId); }
  catch (error) {
    meta.prepare('DELETE FROM projects WHERE id = ?').run(id);
    throw error;
  }
  return { id, name, created_at: now, branches: [{ id: branchId, name: 'main' }] };
}
export async function createBranch(ownerId: string, projectId: string, name: string) {
  const source = meta.prepare('SELECT id FROM branches WHERE project_id = ? AND name = ? AND project_id IN (SELECT id FROM projects WHERE owner_id = ?)').get(projectId, 'main', ownerId) as { id: string } | undefined;
  if (!source) return null;
  const id = nanoid();
  const dbFile = join(dataDir, 'branches', id);
  await mkdir(join(dataDir, 'branches'), { recursive: true });
  const snapshot = await (await getBranchDatabase(source.id)).dumpDataDir('none');
  const createdAt = new Date().toISOString();
  meta.prepare("INSERT INTO branches (id, project_id, name, db_file, created_at, db_kind) VALUES (?, ?, ?, ?, ?, 'pglite')").run(id, projectId, name, dbFile, createdAt);
  try { await createSnapshotBranch(id, dbFile, snapshot); }
  catch (error) {
    meta.prepare('DELETE FROM branches WHERE id = ?').run(id);
    throw error;
  }
  return { id, project_id: projectId, name, created_at: createdAt };
}
export function getBranch(projectId: string, branchId: string) {
  return meta.prepare('SELECT * FROM branches WHERE project_id = ? AND id = ?').get(projectId, branchId) as { id: string; project_id: string; name: string; db_file: string } | undefined;
}
export function listProjects(ownerId: string) {
  return meta.prepare('SELECT id, name, created_at FROM projects WHERE owner_id = ? ORDER BY created_at DESC').all(ownerId);
}
