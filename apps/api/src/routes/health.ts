import { Router } from 'express';

// Used by the Docker healthcheck. Must stay cheap and free of database work (ARCHITECTURE.md 12.6).
export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});
