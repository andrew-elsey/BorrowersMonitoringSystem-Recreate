import { USAGE_TOP_ROWS, type UsageQuery, type UsageSummary } from '@bms/shared';
import { DateTime } from 'luxon';
import { Prisma } from '../generated/prisma/client.ts';
import { config } from '../lib/config.ts';
import { prisma } from '../lib/prisma.ts';

// Usage summary (RPT-4, BR section 4): most borrowed items in a period, with counts by category and
// by room or lab. Read-only, so no audit entry. Everything is counted in SQL (ARCHITECTURE.md 12.5).
// One checkout line is one time borrowed, whatever its quantity, as the approved mockup labels it.

type CountRow = { id: string; name: string; asset_tag?: string | null; times: number };

// from and to are calendar days in the app timezone (CLAUDE.md rule 4): the period runs from the
// start of `from` up to, but not including, the start of the day after `to`.
function periodBounds(from: string, to: string) {
  const zone = config.timezone;
  return {
    start: DateTime.fromISO(from, { zone }).toJSDate(),
    end: DateTime.fromISO(to, { zone }).plus({ days: 1 }).toJSDate(),
  };
}

export async function getUsageSummary({ from, to }: UsageQuery): Promise<UsageSummary> {
  const { start, end } = periodBounds(from, to);
  const lines = Prisma.sql`
    FROM transaction_items ti
    JOIN transactions t ON t.id = ti.transaction_id
    JOIN items i ON i.id = ti.item_id
    JOIN categories c ON c.id = i.category_id
    JOIN locations l ON l.id = t.location_id
    WHERE t.issued_at >= ${start} AND t.issued_at < ${end}`;
  // Most first; ties by name, then id, so the order never changes between requests.
  const top = (name: Prisma.Sql, id: Prisma.Sql) =>
    Prisma.sql`GROUP BY ${id} ORDER BY times DESC, ${name}, ${id} LIMIT ${USAGE_TOP_ROWS}`;

  const [items, categories, rooms] = await Promise.all([
    prisma.$queryRaw<CountRow[]>`
      SELECT i.id, i.name, i.asset_tag, COUNT(*)::int AS times ${lines}
      ${top(Prisma.sql`i.name`, Prisma.sql`i.id`)}`,
    prisma.$queryRaw<CountRow[]>`
      SELECT c.id, c.name, COUNT(*)::int AS times ${lines}
      ${top(Prisma.sql`c.name`, Prisma.sql`c.id`)}`,
    prisma.$queryRaw<CountRow[]>`
      SELECT l.id, l.name, COUNT(*)::int AS times ${lines}
      ${top(Prisma.sql`l.name`, Prisma.sql`l.id`)}`,
  ]);
  const toRow = (row: CountRow) => ({ id: row.id, name: row.name, timesBorrowed: row.times });
  return {
    from,
    to,
    items: items.map((row) => ({ ...toRow(row), assetTag: row.asset_tag ?? null })),
    categories: categories.map(toRow),
    rooms: rooms.map(toRow),
  };
}
