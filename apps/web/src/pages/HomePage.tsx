import { ROLE_LABELS, useAuth } from '../auth';

// Placeholder home until RPT-1 replaces it with the dashboard.
export function HomePage() {
  const user = useAuth().user!;
  return (
    <>
      <h1 className="text-[28px] leading-tight font-bold">Home</h1>
      <section className="flex max-w-[640px] flex-col gap-3 rounded-xl border border-divider bg-surface p-6 leading-relaxed">
        <p>
          You are signed in as <strong>{user.name}</strong> ({ROLE_LABELS[user.role]}).
        </p>
        <p className="text-muted">
          Checkout, returns, and reports will appear in the menu as they are built.
        </p>
      </section>
    </>
  );
}
