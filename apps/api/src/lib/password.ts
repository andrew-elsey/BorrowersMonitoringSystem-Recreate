import { PASSWORD_MIN_LENGTH } from '@bms/shared';
import argon2 from 'argon2';
import { config } from './config.ts';

// All password hashing and verifying goes through this file (CLAUDE.md rule 11, ARCHITECTURE.md 12.4).
// argon2 is deliberately slow and memory hungry, so a limiter caps how many hashes run at once.

// argon2id parameters from ARCHITECTURE.md 5. They are stored inside each hash.
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

// Thrown when the limiter's queue is full. The error handler turns this into 503 SERVER_BUSY with Retry-After.
export class HashingBusyError extends Error {
  constructor() {
    super('Too many password hashes are waiting. Try again shortly.');
  }
}

// Runs at most `concurrency` jobs at once and lets at most `queueMax` more wait.
// Beyond that it refuses immediately instead of queueing without bound.
export function createHashLimiter(concurrency: number, queueMax: number) {
  let running = 0;
  const waiting: (() => void)[] = [];

  return async function run<T>(job: () => Promise<T>): Promise<T> {
    if (running < concurrency) {
      running++;
    } else if (waiting.length < queueMax) {
      // Wait until a finishing job hands its slot over to us.
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      throw new HashingBusyError();
    }

    try {
      return await job();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  };
}

const runLimited = createHashLimiter(config.hashConcurrency, config.hashQueueMax);

export function hashPassword(password: string): Promise<string> {
  return runLimited(() => argon2.hash(password, HASH_OPTIONS));
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return runLimited(() => argon2.verify(hash, password));
}

// Returns an error message when the password breaks the policy, or null when it is fine.
export function checkPasswordPolicy(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  return null;
}
