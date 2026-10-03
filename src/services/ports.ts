import { createServer } from 'node:net';

export type PortProbe = (port: number) => Promise<boolean>;

export async function findAvailablePort(start: number, probe: PortProbe = canBindPort) {
  for (let port = start; port <= 65535; port += 1) {
    if (await probe(port)) return port;
  }
  throw new Error(`No available port found starting at ${start}`);
}

function canBindPort(port: number) {
  return new Promise<boolean>((resolve, reject) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') resolve(false);
      else reject(error);
    });
    server.listen(port, '127.0.0.1', () => {
      server.close((error) => error ? reject(error) : resolve(true));
    });
  });
}
