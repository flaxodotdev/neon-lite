import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { join } from 'node:path';
import { dataDir, meta } from './meta.js';
import { importSqliteBranch } from './sqlite-import.js';
import { findAvailablePort } from '../services/ports.js';

type BranchRow = { id: string; db_file: string; db_kind: string; pg_port: number | null };
type SocketInfo = { server: PGLiteSocketServer; port: number; connectionString: string };

const databases = new Map<string, Promise<PGlite>>();
const sockets = new Map<string, Promise<SocketInfo>>();

export async function getBranchDatabase(branchId: string) {
  const existing = databases.get(branchId);
  if (existing) return existing;
  const opening = openBranchDatabase(branchId);
  databases.set(branchId, opening);
  opening.catch(() => databases.delete(branchId));
  return opening;
}

export async function queryBranch(branchId: string, query: string, params: unknown[] = []) {
  const database = await getBranchDatabase(branchId);
  return database.query(query, params);
}

export async function createSnapshotBranch(branchId: string, directory: string, snapshot: Blob | File) {
  const database = await PGlite.create({ dataDir: directory, loadDataDir: snapshot });
  databases.set(branchId, Promise.resolve(database));
  return database;
}

export async function getBranchSocket(branchId: string) {
  const existing = sockets.get(branchId);
  if (existing) return existing;
  const starting = startSocket(branchId);
  sockets.set(branchId, starting);
  starting.catch(() => sockets.delete(branchId));
  return starting;
}

export async function startAllBranchSockets() {
  const branches = meta.prepare('SELECT id FROM branches ORDER BY created_at').all() as { id: string }[];
  let failed = 0;
  for (const branch of branches) {
    try { await getBranchSocket(branch.id); }
    catch (error) {
      failed += 1;
      console.error(`Could not start Postgres endpoint for branch ${branch.id}:`, error);
    }
  }
  return { total: branches.length, failed };
}

export async function stopBranchRuntime() {
  for (const socketPromise of sockets.values()) {
    try { await (await socketPromise).server.stop(); } catch { /* Shutdown continues for other branches. */ }
  }
  sockets.clear();
  for (const databasePromise of databases.values()) {
    try { await (await databasePromise).close(); } catch { /* Shutdown continues for other branches. */ }
  }
  databases.clear();
}

async function openBranchDatabase(branchId: string) {
  const branch = getBranchRow(branchId);
  if (!branch) throw new Error('Branch not found');
  if (branch.db_kind === 'sqlite') {
    const target = join(dataDir, 'branches', branchId);
    const database = await importSqliteBranch(branch.db_file, target);
    meta.prepare("UPDATE branches SET db_file = ?, db_kind = 'pglite' WHERE id = ?").run(target, branchId);
    return database;
  }
  const database = new PGlite(branch.db_file);
  await database.waitReady;
  return database;
}

async function startSocket(branchId: string): Promise<SocketInfo> {
  const branch = getBranchRow(branchId);
  if (!branch) throw new Error('Branch not found');
  const database = await getBranchDatabase(branchId);
  let port = await findAvailablePort(branch.pg_port ?? 5432);
  while (port <= 65535) {
    const server = new PGLiteSocketServer({ db: database, port, host: '127.0.0.1', maxConnections: 10 });
    try {
      await server.start();
      const connectionString = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`;
      meta.prepare('UPDATE branches SET pg_port = ? WHERE id = ?').run(port, branchId);
      return { server, port, connectionString };
    } catch (error) {
      try { await server.stop(); } catch { /* Start may have failed before the socket was listening. */ }
      if (!isAddressInUse(error) || port === 65535) throw error;
      port = await findAvailablePort(port + 1);
    }
  }
  throw new Error('No free Postgres port is available');
}

function getBranchRow(branchId: string) {
  return meta.prepare('SELECT id, db_file, db_kind, pg_port FROM branches WHERE id = ?').get(branchId) as BranchRow | undefined;
}

function isAddressInUse(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EADDRINUSE';
}
