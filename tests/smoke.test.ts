import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import Database from 'better-sqlite3';

const dir = await mkdtemp(join(tmpdir(), 'neon-lite-test-'));
process.env.DATA_DIR = dir;
process.env.BASE_URL = 'http://localhost:8787';
process.env.BETTER_AUTH_SECRET = 'test-secret-that-is-long-enough-for-better-auth';
const { app } = await import('../src/app.js');
const { getBranchSocket, stopBranchRuntime } = await import('../src/db/branch-runtime.js');
async function expectStatus(response: Response, status: number) {
  assert.equal(response.status, status, await response.clone().text());
}
const json = (response: Response) => response.json() as Promise<Record<string, any>>;

test('smoke: auth, key management, projects, branches, Postgres SQL and wire protocol, storage and functions', async () => {
  try {
    const health = await app.request('/health');
    assert.equal(health.status, 200);
    assert.equal((await json(health)).status, 'ok');

    const signup = await app.request('/api/auth/sign-up/email', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Tester', email: 'test@example.local', password: 'password123456' }),
    });
    assert.ok([200, 201].includes(signup.status), `signup failed (${signup.status}): ${await signup.text()}`);
    const cookie = signup.headers.get('set-cookie');
    assert.ok(cookie, 'signup should establish a session cookie');

    const keyResponse = await app.request('/api/v2/api-keys', {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'tests' }),
    });
    await expectStatus(keyResponse, 201);
    const key = (await json(keyResponse)).api_key.key as string;
    assert.ok(key.startsWith('nl_'));
    const authHeaders = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
    assert.equal((await app.request('/api/v2/projects', { headers: { authorization: `Bearer ${key}` } })).status, 200);

    const created = await app.request('/api/v2/projects', { method: 'POST', headers: authHeaders, body: JSON.stringify({ project: { name: 'smoke' } }) });
    await expectStatus(created, 201);
    const project = (await json(created)).project;
    const branchId = project.branches[0].id as string;

    const query = await app.request(`/sql/${branchId}`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ query: 'CREATE TABLE sample (id INTEGER, value TEXT)' }) });
    await expectStatus(query, 200);
    const insert = await app.request(`/sql/${branchId}`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ query: 'INSERT INTO sample VALUES ($1, $2)', params: [1, 'works'] }) });
    assert.deepEqual(await json(insert), []);
    const select = await app.request(`/sql/${branchId}?neon_lite_meta=true`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ query: 'SELECT * FROM sample' }) });
    assert.deepEqual((await json(select)).rows, [{ id: 1, value: 'works' }]);

    const newBranch = await app.request(`/api/v2/projects/${project.id}/branches`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ branch: { name: 'preview' } }) });
    await expectStatus(newBranch, 201);
    const socket = await getBranchSocket(branchId);
    const endpoint = { connection_uri: socket.connectionString };
    assert.match(endpoint.connection_uri, /^postgresql:\/\/postgres:postgres@127\.0\.0\.1:\d+\/postgres/);
    const pgClient = new Client({ connectionString: endpoint.connection_uri });
    await pgClient.connect();
    const wireResult = await pgClient.query('SELECT value FROM sample WHERE id = $1', [1]);
    assert.deepEqual(wireResult.rows, [{ value: 'works' }]);
    await pgClient.end();
    const copied = await app.request(`/sql/${(await json(newBranch)).branch.id}`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ query: 'SELECT * FROM sample' }) });
    assert.deepEqual(await json(copied), [{ id: 1, value: 'works' }]);

    const put = await app.request('/storage/smoke/hello.txt', { method: 'PUT', headers: authHeaders, body: 'hello storage' });
    await expectStatus(put, 201);
    const get = await app.request('/storage/smoke/hello.txt', { headers: { authorization: `Bearer ${key}` } });
    assert.equal(await get.text(), 'hello storage');
    assert.equal((await app.request('/storage/smoke/hello.txt', { method: 'DELETE', headers: { authorization: `Bearer ${key}` } })).status, 204);

    const functionCreate = await app.request('/functions', { method: 'POST', headers: authHeaders, body: JSON.stringify({ project_id: project.id, name: 'echo', source: 'return { echo: input.message };' }) });
    await expectStatus(functionCreate, 201);
    const functionId = (await json(functionCreate)).id as string;
    const invoked = await app.request(`/functions/${functionId}/invoke`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ message: 'hello' }) });
    assert.deepEqual((await json(invoked)).result, { echo: 'hello' });

    assert.equal((await app.request('/api/v2/projects')).status, 401);
    assert.equal((await app.request('/storage/no-auth')).status, 401);
    assert.equal((await app.request('/functions')).status, 401);
    const missingObject = await app.request('/storage/missing.txt', { headers: { authorization: `Bearer ${key}` } });
    assert.equal(missingObject.status, 404);
    const keyList = await app.request('/api/v2/api-keys', { headers: { authorization: `Bearer ${key}` } });
    assert.equal(keyList.status, 200);
    const keys = await json(keyList) as unknown as { id: string }[];
    const revoke = await app.request(`/api/v2/api-keys/${keys[0].id}`, { method: 'DELETE', headers: { authorization: `Bearer ${key}` } });
    assert.equal(revoke.status, 204);
    assert.equal((await app.request('/api/v2/projects', { headers: { authorization: `Bearer ${key}` } })).status, 401);
  } finally {
    await stopBranchRuntime();
    await rm(dir, { recursive: true, force: true });
  }
});

test('existing SQLite branch data is imported on first query', async () => {
  const legacyFile = join(dir, 'legacy.sqlite');
  await mkdir(dir, { recursive: true });
  const legacy = new Database(legacyFile);
  legacy.exec('CREATE TABLE old_items (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL); INSERT INTO old_items (label) VALUES (\'kept\')');
  legacy.close();
  const ownerId = 'legacy-owner';
  const projectId = 'legacy-project';
  const branchId = 'legacy-branch';
  const now = new Date().toISOString();
  const { meta } = await import('../src/db/meta.js');
  meta.prepare('INSERT INTO projects VALUES (?, ?, ?, ?)').run(projectId, ownerId, 'legacy', now);
  meta.prepare("INSERT INTO branches (id, project_id, name, db_file, created_at, db_kind) VALUES (?, ?, 'main', ?, ?, 'sqlite')").run(branchId, projectId, legacyFile, now);
  const { queryBranch } = await import('../src/db/branch-runtime.js');
  const migrated = await queryBranch(branchId, 'SELECT * FROM old_items');
  assert.deepEqual(migrated.rows, [{ id: 1, label: 'kept' }]);
  await queryBranch(branchId, "INSERT INTO old_items (label) VALUES ('second')");
  const rows = await queryBranch(branchId, 'SELECT * FROM old_items ORDER BY id');
  assert.deepEqual(rows.rows, [{ id: 1, label: 'kept' }, { id: 2, label: 'second' }]);
  assert.equal(meta.prepare('SELECT db_kind FROM branches WHERE id = ?').get(branchId) && (meta.prepare('SELECT db_kind FROM branches WHERE id = ?').get(branchId) as { db_kind: string }).db_kind, 'pglite');
});
