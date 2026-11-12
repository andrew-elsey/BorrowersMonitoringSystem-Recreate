import type { Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { ApiError } from '../lib/errors.ts';

// Request limits from ARCHITECTURE.md 12.3. They key on req.ip, which is the real client address
// only because trust proxy is set (app.ts). Built per app so each app (and each test) starts empty.

const ONE_MINUTE_MS = 60 * 1000;
const GLOBAL_REQUESTS_PER_MINUTE = 600;
// Search is typed live at the counter, so it gets more room than reports and CSV import (owner decision 2026-11-07).
const SEARCH_REQUESTS_PER_MINUTE = 60;
// Reports (one count shared by every report endpoint, owner decision 2026-11-12) and CSV import (its own count).
const EXPENSIVE_REQUESTS_PER_MINUTE = 30;

export function createRequestLimiter(
  limit: number,
  skip?: (req: Request) => boolean,
  keyGenerator?: () => string,
) {
  return rateLimit({
    windowMs: ONE_MINUTE_MS,
    limit,
    skip,
    ...(keyGenerator && { keyGenerator }),
    // Also sets Retry-After when the limit is hit.
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new ApiError(429, 'RATE_LIMITED', 'Too many requests. Try again later.'));
    },
  });
}

// Every API request except the health check, the same ceiling as nginx (10 per second), so
// direct access to the API is still protected.
export function createGlobalRateLimiter() {
  return createRequestLimiter(GLOBAL_REQUESTS_PER_MINUTE);
}

// Search: a list request with ?q=.
export function createSearchRateLimiter() {
  return createRequestLimiter(SEARCH_REQUESTS_PER_MINUTE, (req) => req.query.q === undefined);
}

// Borrower CSV import (MD-6): 30 a minute per address, counted apart from the reports.
export function createCsvImportRateLimiter() {
  return createRequestLimiter(EXPENSIVE_REQUESTS_PER_MINUTE);
}

// Reports (RPT-2 to RPT-4): 30 a minute per address across all report endpoints. app.ts builds one
// and passes it to every report router, so they share the count.
export function createReportRateLimiter() {
  return createRequestLimiter(EXPENSIVE_REQUESTS_PER_MINUTE);
}

// Manual flagging run: once a minute in total (ARCHITECTURE.md 12.5), not per address.
export function createFlaggingRunRateLimiter() {
  return createRequestLimiter(1, undefined, () => 'flagging-run');
}
