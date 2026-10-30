import express from 'express';
import { config } from './lib/config.ts';
import { healthRouter } from './routes/health.ts';

export function createApp() {
  const app = express();
  // Without this every request looks like it comes from nginx (ARCHITECTURE.md 12.3). Never remove it.
  app.set('trust proxy', config.trustProxyHops);
  app.use('/api', healthRouter);
  return app;
}
