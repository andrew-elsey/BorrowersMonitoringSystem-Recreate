import type { LineNote, LineNoteInput } from '@bms/shared';
import { DateTime } from 'luxon';
import { audit } from '../lib/audit.ts';
import { config } from '../lib/config.ts';
import { ApiError } from '../lib/errors.ts';
import { prisma } from '../lib/prisma.ts';

// Line notes (BRW-6, BR 7). A note and an expected return date are informational only: nothing here
// touches flag_status, and the flagging job never reads them (S4).

type LockedLine = {
  quantity_borrowed: number;
  quantity_returned: number;
  note: string | null;
  expected_return_date: Date | null;
};

const toDateString = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;

export async function updateLineNote(
  actorId: string,
  lineId: string,
  { note, expectedReturnDate }: LineNoteInput,
): Promise<LineNote> {
  // BR 7: the expected return date is today or later in the app timezone. YYYY-MM-DD sorts by date.
  const today = DateTime.now().setZone(config.timezone).toISODate()!;
  if (expectedReturnDate && expectedReturnDate < today) {
    const message = 'Choose today or a later date.';
    throw new ApiError(400, 'VALIDATION_ERROR', message, {
      fields: { expectedReturnDate: [message] },
    });
  }
  return prisma.$transaction(async (tx) => {
    // Lock the line so a return at the same moment cannot close it between the check and the
    // update, and the audit's "before" is the value really replaced (ARCHITECTURE.md 8).
    const [line] = await tx.$queryRaw<LockedLine[]>`
      SELECT quantity_borrowed, quantity_returned, note, expected_return_date
      FROM transaction_items WHERE id = ${lineId}::uuid FOR NO KEY UPDATE`;
    if (!line) throw new ApiError(404, 'NOT_FOUND', 'Line not found.');
    // BR 7: only an open line (something still out) takes a note.
    if (line.quantity_returned >= line.quantity_borrowed) {
      throw new ApiError(
        409,
        'LINE_NOT_OPEN',
        'This line is fully returned, so its note can no longer be changed.',
        {
          lineId,
        },
      );
    }
    const updated = await tx.transactionItem.update({
      where: { id: lineId },
      data: {
        note: note || null,
        expectedReturnDate: expectedReturnDate ? new Date(`${expectedReturnDate}T00:00:00Z`) : null,
      },
    });
    const result: LineNote = {
      lineId,
      note: updated.note,
      expectedReturnDate: toDateString(updated.expectedReturnDate),
    };
    // Rule 14
    await audit(tx, {
      actorId,
      action: 'LINE_NOTE_UPDATED',
      entity: 'transaction_item',
      entityId: lineId,
      before: { note: line.note, expectedReturnDate: toDateString(line.expected_return_date) },
      after: { note: result.note, expectedReturnDate: result.expectedReturnDate },
    });
    return result;
  });
}
