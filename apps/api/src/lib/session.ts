import { PrismaSessionStore } from '@quixo3/prisma-session-store';
import type { Role } from '@bms/shared';
import session from 'express-session';
import { config } from './config.ts';
import { prisma } from './prisma.ts';

// Server-side sessions stored in PostgreSQL (ARCHITECTURE.md 5). The browser only holds an opaque ID.

// Keep session data small: who is signed in and their role.
declare module 'express-session' {
  interface SessionData {
    userId: string;
    role: Role;
  }
}

export const SESSION_COOKIE_NAME = 'bms.sid';
const PRUNE_EXPIRED_EVERY_MS = 15 * 60 * 1000;

// Built once per process, so there is one store and one prune timer however many apps are created.
let sessionMiddleware: ReturnType<typeof session> | undefined;

export function getSessionMiddleware() {
  sessionMiddleware ??= createSessionMiddleware();
  return sessionMiddleware;
}

function createSessionMiddleware() {
  if (!config.sessionSecret) {
    throw new Error('SESSION_SECRET is not set. See .env.example.');
  }
  const store = new PrismaSessionStore(prisma, {
    // Expired sessions are deleted every 15 minutes (ARCHITECTURE.md 5).
    checkPeriod: PRUNE_EXPIRED_EVERY_MS,
    dbRecordIdIsSessionId: true,
  });

  return session({
    name: SESSION_COOKIE_NAME,
    secret: config.sessionSecret,
    store,
    // Never store a session for anonymous visitors; one is saved only after a successful login.
    saveUninitialized: false,
    resave: false,
    // Each request pushes the expiry forward (rolling lifetime).
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      maxAge: config.sessionTtlHours * 60 * 60 * 1000,
    },
  });
}
