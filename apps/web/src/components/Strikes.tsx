import type { StrikeStatus } from '@bms/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api';

// Strike messages for Checkout and Return (FLG-3, BR 11). The thresholds come from the API (which
// reads settings, CLAUDE.md rule 3); this only picks the wording. The API enforces the block.

export type StrikeLevel = 'none' | 'warning' | 'notice' | 'blocked';

export function useStrikes(borrowerId: string | undefined) {
  return useQuery({
    queryKey: ['strikes', borrowerId],
    queryFn: () => apiFetch<StrikeStatus>('GET', `/borrowers/${borrowerId}/strikes`),
    enabled: !!borrowerId,
  });
}

export function strikeLevel(s: StrikeStatus): StrikeLevel {
  if (s.strikes >= s.blockThreshold) return 'blocked';
  if (s.strikes >= s.noticeThreshold) return 'notice';
  if (s.strikes >= s.warningThreshold) return 'warning';
  return 'none';
}

export const strikeCount = (strikes: number) =>
  `${strikes} ${strikes === 1 ? 'strike' : 'strikes'}`;

const LABELS = { warning: 'Warning', notice: 'Notice', blocked: 'Blocked' } as const;
const BADGE_CLASS = {
  none: 'bg-page text-ink border-divider',
  warning: 'bg-accent-tint text-ink border-accent',
  notice: 'bg-danger-tint text-danger border-danger/30',
  blocked: 'bg-danger text-white border-danger',
} as const;

// The badge on the Return screen: "Warning: 3 strikes", or just "2 strikes" below the warning.
// Text first, so colour is never the only signal (ARCHITECTURE.md 14).
export function StrikeBadge({ borrowerId }: { borrowerId: string }) {
  const { data } = useStrikes(borrowerId);
  if (!data) return null;
  const level = strikeLevel(data);
  const text =
    level === 'none' ? strikeCount(data.strikes) : `${LABELS[level]}: ${strikeCount(data.strikes)}`;
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-0.5 text-[13px] font-semibold ${BADGE_CLASS[level]}`}
    >
      {text}
    </span>
  );
}
