import { serve } from '@hono/node-server';
import { app } from './app.js';

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => console.log(`Neon Lite listening on http://localhost:${info.port}`));
