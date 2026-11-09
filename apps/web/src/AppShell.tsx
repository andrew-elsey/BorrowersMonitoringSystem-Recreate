import { PERMISSIONS } from '@bms/shared';
import { Suspense, useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { ROLE_LABELS, useAuth } from './auth';
import { BoxIcon } from './components/icons';
import { NotificationProvider } from './components/Notifications';

// The menu, in SPEC.md 5 order. Each item lists the roles that may open it (SPEC.md 3), and an item
// is added only when its screen is built: the rest join in their own tickets.
const NAV_ITEMS = [
  { to: '/', label: 'Home', roles: PERMISSIONS.viewDashboardAndReports },
  { to: '/checkout', label: 'Checkout', roles: PERMISSIONS.checkoutAndReturn },
  { to: '/return', label: 'Return', roles: PERMISSIONS.checkoutAndReturn },
  { to: '/inventory', label: 'Inventory and categories', roles: PERMISSIONS.manageMasterData },
  { to: '/borrowers', label: 'Borrowers', roles: PERMISSIONS.manageMasterData },
  { to: '/rooms', label: 'Rooms and labs', roles: PERMISSIONS.manageMasterData },
  {
    to: '/settings',
    label: 'Settings and semesters',
    roles: PERMISSIONS.manageSettingsAndSemesters,
  },
];

// Top bar elements sit on green, so their focus ring is gold (ARCHITECTURE.md 14).
const onBarFocus = 'focus-visible:outline-accent';

export function AppShell() {
  const { user, signOut } = useAuth();
  const role = user!.role;
  // The tab title names the page. An unknown path redirects home, so it never reaches here.
  const { pathname } = useLocation();
  const path = pathname.replace(/\/+$/, '') || '/'; // /checkout/ is the same page as /checkout
  const navItem = NAV_ITEMS.find((item) => item.to === path);
  const page =
    path === '/password'
      ? 'Change password'
      : navItem && !(navItem.roles as readonly string[]).includes(role)
        ? 'Not allowed'
        : (navItem?.label ?? 'Home');
  useEffect(() => {
    document.title = `${page} · Borrowers Monitoring System`;
  }, [page]);

  return (
    <div className="flex min-h-screen flex-col bg-page">
      {/* Lets keyboard users jump past the top bar and menu. Hidden until it has focus. */}
      <a
        href="#main"
        className="sr-only rounded-lg bg-surface px-4 py-2.5 text-[15px] font-semibold text-primary focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-20"
      >
        Skip to main content
      </a>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-4 border-accent bg-primary px-6 py-3 text-white">
        <div className="flex items-center gap-2.5">
          <BoxIcon size={24} />
          <span className="text-[17px] font-bold">Borrowers Monitoring System</span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 text-[15px]">
            <span>{user!.name}</span>
            <span className="rounded-full bg-accent px-2.5 py-0.5 text-[13px] font-semibold text-ink">
              {ROLE_LABELS[role]}
            </span>
          </div>
          <NavLink
            to="/password"
            className={({ isActive }) =>
              `px-1 py-2.5 text-[15px] text-white underline-offset-4 hover:underline ${isActive ? 'font-semibold underline' : 'font-medium'} ${onBarFocus}`
            }
          >
            Change password
          </NavLink>
          <button
            type="button"
            onClick={signOut} // the route guard then shows the login page
            className={`h-10 cursor-pointer rounded-lg border border-white px-4 text-[15px] font-medium transition-colors duration-150 hover:bg-primary-hover ${onBarFocus}`}
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-wrap content-start items-start">
        <nav
          aria-label="Main"
          className="flex max-w-[260px] flex-[1_1_220px] flex-col gap-1 px-3 py-5"
        >
          {NAV_ITEMS.filter((item) => (item.roles as readonly string[]).includes(role)).map(
            (item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className={({ isActive }) =>
                  `flex min-h-11 items-center rounded-lg px-3.5 text-[15px] no-underline transition-colors duration-150 ${
                    isActive
                      ? 'bg-primary-tint font-semibold text-primary'
                      : 'font-medium text-ink hover:bg-divider/40'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ),
          )}
        </nav>
        <main
          id="main"
          tabIndex={-1} // so the skip link moves keyboard focus here, not only the scroll position
          className="flex min-w-0 flex-[999_1_560px] flex-col gap-5 px-6 py-8 focus:outline-none"
        >
          <NotificationProvider>
            {/* Fallback while a lazy screen page's chunk downloads (HRD-6, see App.tsx). */}
            <Suspense
              fallback={
                <p role="status" className="text-muted">
                  Loading…
                </p>
              }
            >
              <Outlet />
            </Suspense>
          </NotificationProvider>
        </main>
      </div>
    </div>
  );
}
