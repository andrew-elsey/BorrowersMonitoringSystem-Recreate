import type { Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { ApiError } from '../lib/errors.ts';

// Request limits from ARCHITECTURE.md 12.3. They key on req.ip, which is the real client address
// only because trust proxy is set (app.ts). Built per app so each app (and each test) starts empty.

const ONE_MINUTE_MS = 60 * 1000;
const GLOBAL_REQUESTS_PER_MINUTE = 600;
// Search is typed live at the counter, so it gets more room than reports and CSV import (owner decision 2026-11-07).
const SEARCH_REQUESTS_PER_MINUTE = 60;

function createRequestLimiter(limit: number, skip?: (req: Request) => boolean) {
  return rateLimit({
    windowMs: ONE_MINUTE_MS,
    limit,
    skip,
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

// Search: a list request with ?q=. Reports and CSV import get their own 30 a minute limit later.
export function createSearchRateLimiter() {
  return createRequestLimiter(SEARCH_REQUESTS_PER_MINUTE, (req) => req.query.q === undefined);
}
