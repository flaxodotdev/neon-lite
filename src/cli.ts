#!/usr/bin/env node
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { findAvailablePort } from './services/ports.js';
import { getBranchSocket, startAllBranchSockets, stopBranchRuntime } from './db/branch-runtime.js';

const VERSION = '0.2.0';
const OWNER_ID = 'neon-lite-local-cli';

async function main(args: string[]) {
  const [command = 'start', ...rest] = args;
  if (command === 'help' || command === '--help' || command === '-h') return showHelp();
  if (command === 'version' || command === '--version' || command === '-v') return console.log(`neon-lite ${VERSION}`);

  configureDataDirectory(rest);
  if (command === 'create' || command === 'init') {
    const name = rest[0]?.startsWith('-') ? undefined : rest[0];
    if (!name) throw new Error(`Usage: neon-lite ${command} <project-name>`);
    const { createProject } = await import('./services/projects.js');
    const { createApiKey } = await import('./services/keys.js');
    const project = await createProject(OWNER_ID, name);
    const key = createApiKey(OWNER_ID, `${name} local key`);
    if (command === 'init') {
      await startServer(rest, async (port) => {
        const postgres = await getBranchSocket(project.branches[0].id);
        printProject(project, key.key, true, port, postgres.connectionString);
      });
    } else {
      printProject(project, key.key, false, portFromArgs(rest));
    }
    return;
  }
  if (command === 'projects' || command === 'list') {
    const { listProjects } = await import('./services/projects.js');
    console.table(listProjects(OWNER_ID));
    return;
  }
  if (command === 'start') return startServer(rest);
  throw new Error(`Unknown command: ${command}. Run "neon-lite help" for usage.`);
}

function configureDataDirectory(args: string[]) {
  const dataFlag = args.indexOf('--data-dir');
  const homeFlag = args.indexOf('--home');
  const explicitData = dataFlag >= 0 ? args[dataFlag + 1] : undefined;
  const explicitHome = homeFlag >= 0 ? args[homeFlag + 1] : undefined;
  const defaultHome = resolve(explicitHome ?? process.env.NEON_LITE_HOME ?? join(homedir(), '.neon-lite'));
  process.env.NEON_LITE_HOME = defaultHome;
  process.env.DATA_DIR = resolve(explicitData ?? process.env.DATA_DIR ?? join(defaultHome, 'data'));
  mkdirSync(process.env.DATA_DIR, { recursive: true });
}

function printProject(project: { id: string; name: string; branches: { id: string; name: string }[] }, key: string, startsServer: boolean, port: number, postgresUrl?: string) {
  const base = process.env.BASE_URL ?? `http://localhost:${port}`;
  console.log(`Created local project: ${project.name}`);
  console.log(`Project ID: ${project.id}`);
  console.log(`Branch: ${project.branches[0]?.name}`);
  console.log(`SQL endpoint: ${base}/sql/${project.branches[0]?.id}`);
  if (postgresUrl) console.log(`Postgres URL: ${postgresUrl}`);
  console.log(`API key (shown once): ${key}`);
  console.log(startsServer ? '\nStarting the local API now…' : '\nStart the local API with: neon-lite start');
}

async function startServer(args: string[], onReady?: (port: number) => void) {
  const requestedPort = portFromArgs(args);
  const port = await findAvailablePort(requestedPort);
  if (port !== requestedPort) console.log(`Port ${requestedPort} is already in use. Using port ${port}.`);
  process.env.PORT = String(port);
  process.env.BASE_URL ??= `http://localhost:${port}`;
  const [{ app }, { serve }] = await Promise.all([
    import('./app.js'),
    import('@hono/node-server'),
  ]);
  await startAllBranchSockets();
  const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
    Promise.resolve(onReady?.(info.port)).then(() => {
      console.log(`Neon Lite is ready at http://localhost:${info.port}`);
      console.log(`Data directory: ${process.env.DATA_DIR}`);
    }).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  });
  server.once('error', (error: NodeJS.ErrnoException) => {
    console.error(error.code === 'EADDRINUSE'
      ? `Port ${port} became occupied before Neon Lite could start. Retry the command.`
      : `Could not start Neon Lite: ${error.message}`);
    process.exitCode = 1;
  });
  const shutdown = () => server.close(() => {
    void stopBranchRuntime().finally(() => process.exit(0));
  });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

function portFromArgs(args: string[]) {
  const index = args.indexOf('--port');
  const parsed = index >= 0 ? Number(args[index + 1]) : Number(process.env.PORT ?? 8787);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error('Port must be between 1 and 65535');
  return parsed;
}

function showHelp() {
  console.log(`Neon Lite ${VERSION}\n\nUsage:\n  neon-lite [start] [--port 8787] [--data-dir PATH]\n  neon-lite create <name>\n  neon-lite init <name> [--port 8787]\n  neon-lite projects\n\nCommands:\n  start       Start the local API server (default)\n  create      Create another Postgres project and print its endpoint and API key\n  init        Create a project, then start the API server\n  projects    List projects in the local data directory\n\nOptions:\n  --data-dir PATH  Store data at a specific path\n  --home PATH      Set Neon Lite's home directory (default ~/.neon-lite)\n  --port PORT      Set the local server port (default 8787)`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
