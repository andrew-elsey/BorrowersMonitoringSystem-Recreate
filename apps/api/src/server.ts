import type { Express } from 'express';
import type { Server } from 'node:http';

// Starts the HTTP server with the Node timeouts from ARCHITECTURE.md 12.3, so slow or stuck
// connections are dropped instead of holding sockets open.
export function startServer(app: Express, port: number): Server {
  const server = app.listen(port);
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

// ARCHITECTURE.md 12.3: an error nobody handled leaves the process in an unknown state, so log it
// and exit. restart: unless-stopped in docker-compose.yml then starts a fresh container.
export function exitOnUnhandledErrors(): void {
  const crash = (error: unknown) => {
    console.error('Unhandled error, exiting so Docker restarts the API:', error);
    process.exit(1);
  };
  process.on('unhandledRejection', crash);
  process.on('uncaughtException', crash);
}
