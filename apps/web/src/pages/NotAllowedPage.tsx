import { Link } from 'react-router';
import { ROLE_LABELS, useAuth } from '../auth';
import { LockIcon } from '../components/icons';

// Shown inside the app shell when the user's role may not open a page (SPEC.md 3).
export function NotAllowedPage({ pageName }: { pageName: string }) {
  const user = useAuth().user!;
  return (
    <section className="flex max-w-[560px] flex-col items-start gap-4 rounded-xl border border-divider bg-surface p-8">
      <div className="flex size-11 items-center justify-center rounded-full bg-danger-tint text-danger">
        <LockIcon />
      </div>
      <h1 className="text-[26px] leading-tight font-bold">You can't open this page</h1>
      <p className="leading-relaxed">
        Your role, {ROLE_LABELS[user.role]}, does not have access to <strong>{pageName}</strong>. If
        you need it for your work, ask an admin to change your role.
      </p>
      <Link
        to="/"
        className="inline-flex h-11 items-center rounded-lg bg-primary px-5 text-base font-semibold text-white no-underline transition-colors duration-150 hover:bg-primary-hover"
      >
        Go to home
      </Link>
    </section>
  );
}
