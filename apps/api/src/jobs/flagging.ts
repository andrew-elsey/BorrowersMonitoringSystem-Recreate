import { DateTime } from 'luxon';
import { audit } from '../lib/audit.ts';
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
    const lines = await tx.$queryRaw<{ id: string }[]>`
      SELECT ti.id FROM transaction_items ti
      JOIN transactions t ON t.id = ti.transaction_id
      WHERE ti.flag_status = 'NONE' AND ti.quantity_returned < ti.quantity_borrowed
        AND t.issued_at < ${closing}`;
    for (const { id } of lines) {
      await tx.transactionItem.update({
        where: { id },
        data: { flagStatus: 'FLAGGED', flaggedAt: now },
      });
      // Audit in the same transaction (CLAUDE.md rule 6)
      await audit(tx, {
        actorId,
        action: 'LINE_FLAGGED',
        entity: 'transaction_item',
        entityId: id,
        before: { flagStatus: 'NONE' },
        after: { flagStatus: 'FLAGGED', flaggedAt: now.toISOString() },
      });
    }
    return { flagged: lines.length, skipped: false };
  });
  console.log(`Flagging run at ${now.toISOString()}: ${JSON.stringify(run)}`);
  return run;
}

let timer: NodeJS.Timeout | undefined;
let started = false;

async function scheduleNext(now = new Date()): Promise<void> {
  clearTimeout(timer);
  const { closingTime } = await getSettings();
  const next = latestClosing(now, closingTime).plus({ days: 1 });
  timer = setTimeout(() => {
    runFlagging(new Date())
      .catch((error) => console.error('Flagging run failed:', error))
      .finally(() => scheduleNext());
  }, next.toMillis() - now.getTime());
  timer.unref();
}

// Called once at API startup: catches up on missed closings (BR 9), then waits for the next one.
export async function startFlagging(now = new Date()): Promise<void> {
  started = true;
  await runFlagging(now);
  await scheduleNext(now);
}

// Called after the closing time setting is saved (ARCHITECTURE.md 6). No-op until started.
export async function rescheduleFlagging(now = new Date()): Promise<void> {
  if (started) await scheduleNext(now);
}

export function stopFlagging(): void {
  started = false;
  clearTimeout(timer);
}
