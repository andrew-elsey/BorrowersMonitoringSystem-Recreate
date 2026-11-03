import express from 'express';
import helmet from 'helmet';
import { config } from './lib/config.ts';
import { ApiError } from './lib/errors.ts';
import { getSessionMiddleware } from './lib/session.ts';
import { requireFetchHeader } from './middleware/auth.ts';
import { errorHandler } from './middleware/errors.ts';
import { createAuthRouter } from './routes/auth.ts';
import { createBorrowersRouter } from './routes/borrowers.ts';
import { createCategoriesRouter } from './routes/categories.ts';
import { createItemsRouter } from './routes/items.ts';
import { createRoomsRouter } from './routes/rooms.ts';
import { createSettingsRouter } from './routes/settings.ts';
import { healthRouter } from './routes/health.ts';

export function createApp() {
  const app = express();
  // Without this every request looks like it comes from nginx (ARCHITECTURE.md 12.3). Never remove it.
  app.set('trust proxy', config.trustProxyHops);
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  // Health stays free of session and database work (ARCHITECTURE.md 12.6).
  app.use('/api', healthRouter);
  app.use('/api', requireFetchHeader, getSessionMiddleware());
  app.use('/api', createAuthRouter());
  app.use('/api', createCategoriesRouter());
  app.use('/api', createBorrowersRouter());
  app.use('/api', createItemsRouter());
  app.use('/api', createRoomsRouter());
  app.use('/api', createSettingsRouter());
  // Unknown API paths get the standard error format too (CLAUDE.md rule 10), not Express's HTML page.
  app.use('/api', () => {
    throw new ApiError(404, 'NOT_FOUND', 'Not found.');
  });
  app.use(errorHandler);
  return app;
}
