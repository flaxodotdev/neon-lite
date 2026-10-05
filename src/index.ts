import { serve } from '@hono/node-server';
import { app } from './app.js';
import { startAllBranchSockets, stopBranchRuntime } from './db/branch-runtime.js';

const port = Number(process.env.PORT ?? 8787);
await startAllBranchSockets();
const server = serve({ fetch: app.fetch, port }, (info) => console.log(`Neon Lite listening on http://localhost:${info.port}`));
const shutdown = () => server.close(() => {
  void stopBranchRuntime().finally(() => process.exit(0));
});
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
