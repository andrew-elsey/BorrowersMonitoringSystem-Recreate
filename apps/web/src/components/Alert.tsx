import type { ReactNode } from 'react';
import { AlertIcon, CheckIcon, ClockIcon } from './icons';

// Every message pairs its color with an icon and text, never color alone (ARCHITECTURE.md 14).
const KINDS = {
  error: {
    role: 'alert',
    icon: <AlertIcon />,
    className: 'bg-danger-tint border-danger/30 text-danger',
  },
  wait: { role: 'alert', icon: <ClockIcon />, className: 'bg-accent-tint border-accent text-ink' },
  success: {
    role: 'status',
    icon: <CheckIcon />,
    className: 'bg-primary-tint border-primary/40 text-primary',
  },
} as const;

export function Alert({ kind, children }: { kind: keyof typeof KINDS; children: ReactNode }) {
  const { role, icon, className } = KINDS[kind];
  return (
    <div
      role={role}
      className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[15px] leading-normal ${className}`}
    >
      {icon}
      <span>{children}</span>
    </div>
  );
}
