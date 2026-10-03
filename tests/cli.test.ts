import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { findAvailablePort } from '../src/services/ports.js';

test('CLI creates multiple projects and lists them from persistent local storage', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'neon-lite-cli-'));
  const entry = resolve('src/cli.ts');
  const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', entry, ...args], {
    cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, DATA_DIR: dataDir },
  });
  try {
    const first = run('create', 'web-app');
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Created local project: web-app/);
    assert.match(first.stdout, /SQL endpoint: http:\/\/localhost:8787\/sql\//);
    assert.match(first.stdout, /API key \(shown once\): nl_/);

    const second = run('create', 'worker');
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /Created local project: worker/);

    const listed = run('projects');
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /web-app/);
    assert.match(listed.stdout, /worker/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('port selection skips ports that are already occupied', async () => {
  const occupied = new Set([8787, 8788]);
  const port = await findAvailablePort(8787, async (candidate) => !occupied.has(candidate));
  assert.equal(port, 8789);
  await assert.rejects(findAvailablePort(65535, async () => false), /No available port found/);
});
