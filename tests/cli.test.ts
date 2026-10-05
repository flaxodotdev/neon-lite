import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { findAvailablePort } from '../src/services/ports.js';
import { createServer } from 'node:net';

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

test('init prints startup details and accepts termination', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'neon-lite-init-'));
  const entry = resolve('src/cli.ts');
  const probe = createServer();
  const port = await new Promise<number>((resolvePort, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address && typeof address !== 'string') resolvePort(address.port);
      probe.close();
    });
  });
  const child = spawn(process.execPath, ['--import', 'tsx', entry, 'init', 'quickstart', '--port', String(port), '--data-dir', dataDir], {
    cwd: process.cwd(), env: { ...process.env, DATA_DIR: dataDir },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  await waitForOutput(child, () => stdout, /Data directory:/, 20_000);
  try {
    assert.match(stdout, /Created local project: quickstart/);
    assert.match(stdout, /Postgres URL: postgresql:\/\/postgres:postgres@127\.0\.0\.1:\d+\/postgres/);
    assert.match(stdout, new RegExp(`Neon Lite is ready at http://localhost:${port}`));
    assert.match(stdout, /Data directory:/);
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    await rm(dataDir, { recursive: true, force: true });
  }
  assert.equal(stderr, '');
});

function waitForOutput(child: ChildProcess, getOutput: () => string, pattern: RegExp, timeoutMs: number) {
  return new Promise<void>((resolveOutput, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for CLI output. Received: ${getOutput()}`)), timeoutMs);
    const check = () => {
      if (pattern.test(getOutput())) {
        clearTimeout(timeout);
        resolveOutput();
      }
    };
    child.stdout?.on('data', check);
    child.once('exit', (code) => {
      if (!pattern.test(getOutput())) {
        clearTimeout(timeout);
        reject(new Error(`CLI exited with ${code} before printing readiness. Received: ${getOutput()}`));
      }
    });
  });
}
