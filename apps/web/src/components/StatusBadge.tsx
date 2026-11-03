// Text and color together, never color alone (ARCHITECTURE.md 14).
export function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${active ? 'bg-primary-tint text-primary' : 'bg-page text-muted'}`}
    >
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}
