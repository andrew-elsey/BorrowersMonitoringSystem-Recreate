import express from 'express';
import helmet from 'helmet';
import { config } from './lib/config.ts';
import { ApiError } from './lib/errors.ts';
import { getSessionMiddleware } from './lib/session.ts';
import { requireFetchHeader } from './middleware/auth.ts';
import { errorHandler } from './middleware/errors.ts';
import { createFlaggingRouter } from './routes/flagging.ts';
import { createFlagsRouter } from './routes/flags.ts';
import { createGlobalRateLimiter, createReportRateLimiter } from './middleware/request-rate-limit.ts';
import { createAuthRouter } from './routes/auth.ts';
import { createBorrowersRouter } from './routes/borrowers.ts';
import { createCategoriesRouter } from './routes/categories.ts';
import { createDashboardRouter } from './routes/dashboard.ts';
import { createItemsRouter } from './routes/items.ts';
import { createRoomsRouter } from './routes/rooms.ts';
import { createSettingsRouter } from './routes/settings.ts';
import { createTransactionsRouter } from './routes/transactions.ts';
import { createHistoryRouter } from './routes/history.ts';
import { createUsersRouter } from './routes/users.ts';
import { healthRouter } from './routes/health.ts';
import { createUsageReportRouter } from './routes/usage-report.ts';

export function createApp() {
  const app = express();
  // Without this every request looks like it comes from nginx (ARCHITECTURE.md 12.3). Never remove it.
  app.set('trust proxy', config.trustProxyHops);
  app.use(helmet());
  // Health stays free of session and database work (ARCHITECTURE.md 12.6).
  app.use('/api', healthRouter);
  // The global limit runs before the body is parsed, so an over-limit client costs no parsing.
  app.use('/api', createGlobalRateLimiter());
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', requireFetchHeader, getSessionMiddleware());
  app.use('/api', createAuthRouter());
  app.use('/api', createCategoriesRouter());
  app.use('/api', createBorrowersRouter());
  app.use('/api', createItemsRouter());
  app.use('/api', createRoomsRouter());
  app.use('/api', createSettingsRouter());
  app.use('/api', createFlaggingRouter());
  app.use('/api', createFlagsRouter());
  app.use('/api', createTransactionsRouter());
  app.use('/api', createDashboardRouter());
  // One reports limiter shared by every report router, so all reports count together (ARCHITECTURE.md 12.3).
  const reportLimiter = createReportRateLimiter();
  app.use('/api', createHistoryRouter(reportLimiter));
  app.use('/api', createUsersRouter());
  app.use('/api', createUsageReportRouter(reportLimiter));
  // Unknown API paths get the standard error format too (CLAUDE.md rule 10), not Express's HTML page.
  app.use('/api', () => {
    throw new ApiError(404, 'NOT_FOUND', 'Not found.');
  });
  app.use(errorHandler);
  return app;
}
