import { DateTime } from 'luxon';
import { auditMany } from '../lib/audit.ts';
import { config } from '../lib/config.ts';
import { prisma } from '../lib/prisma.ts';
import { getSettings } from '../services/settings.ts';

// End-of-day flagging job (FLG-2, BR 8 and 9). Strikes are counted from the flagged lines (FLG-1).

// Arbitrary constant: every run (scheduled, startup, manual) takes this PostgreSQL advisory lock.
export const FLAGGING_LOCK_KEY = 8_100_002;

export type FlaggingRun = { flagged: number; skipped: boolean };

// The latest closing time at or before `now`, in the app timezone (ARCHITECTURE.md 6).
function latestClosing(now: Date, closingTime: string): DateTime {
  const [hour, minute] = closingTime.split(':').map(Number) as [number, number];
  const today = DateTime.fromJSDate(now, { zone: config.timezone }).set({
    hour,
    minute,
    second: 0,
    millisecond: 0,
  });
  return today <= DateTime.fromJSDate(now) ? today : today.minus({ days: 1 });
}

// BR 8: flags every open, unflagged line issued before the latest closing time. BR 9: because the
// cutoff is the latest closing, a run after downtime also catches every missed closing, and a line
// issued after that closing waits for the next one. Running again changes nothing (idempotent).
// `actorId` is the admin for a manual run, null for the system.
export async function runFlagging(now: Date, actorId: string | null = null): Promise<FlaggingRun> {
  const closing = latestClosing(now, (await getSettings()).closingTime).toJSDate();
  const run = await prisma.$transaction(async (tx) => {
    // Another run holds the lock: skip, it is doing the same work.
    const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(${FLAGGING_LOCK_KEY}) AS locked`;
    if (!locked) return { flagged: 0, skipped: true };
    // One set-based UPDATE, so a large backlog fits in the transaction. It re-checks flag_status, so
    // FLAGGED and OVERRIDDEN lines are never touched (idempotent).
    const lines = await tx.$queryRaw<{ id: string }[]>`
      UPDATE transaction_items
      SET flag_status = 'FLAGGED', flagged_at = ${now}, updated_at = ${now}
      WHERE flag_status = 'NONE' AND quantity_returned < quantity_borrowed
        AND transaction_id IN (SELECT id FROM transactions WHERE issued_at < ${closing})
      RETURNING id`;
    // Audit in the same transaction (CLAUDE.md rule 6).
    await auditMany(
      tx,
      lines.map(({ id }) => ({
        actorId,
        action: 'LINE_FLAGGED',
        entity: 'transaction_item',
        entityId: id,
        before: { flagStatus: 'NONE' },
        after: { flagStatus: 'FLAGGED', flaggedAt: now.toISOString() },
      })),
    );
    return { flagged: lines.length, skipped: false };
  });
  console.log(`Flagging run at ${now.toISOString()}: ${JSON.stringify(run)}`);
  return run;
}

// Owner decision B: a failed or skipped scheduled run is retried about every minute.
export const FLAGGING_RETRY_MS = 60_000;

let timer: NodeJS.Timeout | undefined;
let started = false;

// clearTimeout sits right before setTimeout, so overlapping calls always leave exactly one timer.
function arm(delayMs: number): void {
  clearTimeout(timer);
  timer = setTimeout(() => void runAndSchedule(new Date()), delayMs);
  timer.unref();
}

// Runs once, then waits for the next closing, or retries in a minute if the run failed or was skipped.
// Never throws.
async function runAndSchedule(now: Date): Promise<void> {
  let delayMs = FLAGGING_RETRY_MS;
  try {
    const { closingTime } = await getSettings();
    const run = await runFlagging(now);
    if (!run.skipped) {
      delayMs = latestClosing(now, closingTime).plus({ days: 1 }).toMillis() - now.getTime();
    }
  } catch (error) {
    console.error('Flagging run failed, retrying:', error);
  }
  if (started) arm(delayMs); // not after stopFlagging
}

// Called once at API startup: catches up on missed closings (BR 9), then waits for the next one.
export async function startFlagging(now = new Date()): Promise<void> {
  started = true;
  await runAndSchedule(now);
}

// Called after the closing time setting is saved (ARCHITECTURE.md 6). Owner decision A: runs right
// away, so a new closing time that has already passed today flags at once (a no-op otherwise).
// No-op until started.
export async function rescheduleFlagging(now = new Date()): Promise<void> {
  if (started) await runAndSchedule(now);
}

export function stopFlagging(): void {
  started = false;
  clearTimeout(timer);
}
