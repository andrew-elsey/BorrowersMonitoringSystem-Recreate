import type { Request } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { ApiError } from '../lib/errors.ts';

// Rule 16 and ARCHITECTURE.md 12.4: failed logins are throttled, never locked. These run before the
// login handler, so a throttled request never reaches password hashing (scenario S20).

const WINDOW_MS = 15 * 60 * 1000;
const FAILURES_PER_IP_AND_USERNAME = 10;
const FAILURES_PER_IP = 30;

function clientIp(req: Request): string {
  // req.ip is the real client address because trust proxy is set (ARCHITECTURE.md 12.3).
  return ipKeyGenerator(req.ip ?? '');
}

function createFailedLoginLimiter(limit: number, keyGenerator: (req: Request) => string) {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit,
    keyGenerator,
    // Only failed logins count: a successful one gives its hit back.
    skipSuccessfulRequests: true,
    // Also sets Retry-After when the limit is hit.
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new ApiError(429, 'RATE_LIMITED', 'Too many failed sign-in attempts. Try again later.'));
    },
  });
}

// Built per app so each app (and each test) starts with empty counters.
export function createLoginRateLimiters() {
  return [
    // Per IP and username: an attacker guessing one account. The same user on another machine is unaffected.
    createFailedLoginLimiter(FAILURES_PER_IP_AND_USERNAME, (req) => {
      const username = typeof req.body?.username === 'string' ? req.body.username : '';
      return `${clientIp(req)}|${username.trim().toLowerCase()}`;
    }),
    // Per IP: one machine trying many usernames.
    createFailedLoginLimiter(FAILURES_PER_IP, clientIp),
  ];
}
