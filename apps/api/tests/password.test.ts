import { expect, test } from 'vitest';
import {
  createHashLimiter,
  hashPassword,
  HashingBusyError,
  verifyPassword,
} from '../src/lib/password.ts';

test('hashes with argon2id and verifies', async () => {
  const hash = await hashPassword('correct-password');
  expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
  expect(await verifyPassword(hash, 'correct-password')).toBe(true);
  expect(await verifyPassword(hash, 'wrong-password')).toBe(false);
});

test('the limiter runs at most `concurrency` jobs at once and refuses beyond the queue', async () => {
  const run = createHashLimiter(2, 1);
  let running = 0;
  let mostAtOnce = 0;
  const releases: (() => void)[] = [];
  const job = () =>
    new Promise<void>((resolve) => {
      running++;
      mostAtOnce = Math.max(mostAtOnce, running);
      releases.push(() => {
        running--;
        resolve();
      });
    });

  const accepted = [run(job), run(job), run(job)]; // 2 running, 1 waiting
  await expect(run(job)).rejects.toBeInstanceOf(HashingBusyError); // queue full

  // Release jobs one by one until all three accepted jobs have run.
  while (releases.length > 0 || running > 0) {
    releases.shift()?.();
    await new Promise((resolve) => setImmediate(resolve));
  }
  await Promise.all(accepted);
  expect(mostAtOnce).toBe(2);

  // Once the work has drained, new jobs are accepted again.
  await expect(run(async () => 'ok')).resolves.toBe('ok');
});
