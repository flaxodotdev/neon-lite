import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const dataDir = resolve(process.env.DATA_DIR ?? './data');
mkdirSync(dataDir, { recursive: true });
const filename = resolve(dataDir, 'control.sqlite');
mkdirSync(dirname(filename), { recursive: true });
export const meta = new Database(filename);
meta.pragma('journal_mode = WAL');
meta.pragma('foreign_keys = ON');
meta.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL, db_file TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(project_id, name)
  );
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL,
    secret_hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS functions (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(project_id, name)
  );
`);
