import { PERMISSIONS, type Role } from '@bms/shared';
import { lazy, type ReactNode } from 'react';
import { Navigate, useLocation, type RouteObject } from 'react-router';
import { AppShell } from './AppShell';
import { useAuth } from './auth';
import { LoginPage } from './pages/LoginPage';
import { NotAllowedPage } from './pages/NotAllowedPage';

// Screen pages load on demand so the sign-in screen and the app shell download first (HRD-6).
// AppShell shows the Suspense fallback while a page's chunk loads.
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const FlagReviewPage = lazy(() =>
  import('./pages/FlagReviewPage').then((m) => ({ default: m.FlagReviewPage })),
);
const ReturnPage = lazy(() =>
  import('./pages/ReturnPage').then((m) => ({ default: m.ReturnPage })),
);
const CheckoutPage = lazy(() =>
  import('./pages/CheckoutPage').then((m) => ({ default: m.CheckoutPage })),
);
const InventoryPage = lazy(() =>
  import('./pages/InventoryPage').then((m) => ({ default: m.InventoryPage })),
);
const BorrowersPage = lazy(() =>
  import('./pages/BorrowersPage').then((m) => ({ default: m.BorrowersPage })),
);
const RoomsPage = lazy(() => import('./pages/RoomsPage').then((m) => ({ default: m.RoomsPage })));
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const ReportsPage = lazy(() =>
  import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);
const ChangePasswordPage = lazy(() =>
  import('./pages/ChangePasswordPage').then((m) => ({ default: m.ChangePasswordPage })),
);

// Route guard: signed-out users go to the login page. After an expired session, login sends them
// back to this page; after Sign out it sends them home.
function RequireSignIn({ children }: { children: ReactNode }) {
  const { user, signedOutOnPurpose } = useAuth();
  const location = useLocation();
  if (!user) {
    const state = signedOutOnPurpose ? undefined : { from: location.pathname + location.search };
    return <Navigate to="/login" replace state={state} />;
  }
  return children;
}

// Route guard: a role not in the SPEC.md 3 permission table sees the "not allowed" page.
// The API checks the role again on every request; this only gives a clear message.
export function RequireRole(props: {
  roles: readonly Role[];
  pageName: string;
  children: ReactNode;
}) {
  const role = useAuth().user!.role;
  if (!props.roles.includes(role)) return <NotAllowedPage pageName={props.pageName} />;
  return props.children;
}

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: (
      <RequireSignIn>
        <AppShell />
      </RequireSignIn>
    ),
    children: [
      {
        index: true,
        element: (
          <RequireRole roles={PERMISSIONS.viewDashboardAndReports} pageName="Dashboard">
            <DashboardPage />
          </RequireRole>
        ),
      },
      {
        path: 'checkout',
        element: (
          <RequireRole roles={PERMISSIONS.checkoutAndReturn} pageName="Checkout">
            <CheckoutPage />
          </RequireRole>
        ),
      },
      {
        path: 'return',
        element: (
          <RequireRole roles={PERMISSIONS.checkoutAndReturn} pageName="Return">
            <ReturnPage />
          </RequireRole>
        ),
      },
      {
        path: 'flags',
        element: (
          <RequireRole roles={PERMISSIONS.overrideFlags} pageName="Flag review">
            <FlagReviewPage />
          </RequireRole>
        ),
      },
      {
        path: 'inventory',
        element: (
          <RequireRole roles={PERMISSIONS.manageMasterData} pageName="Inventory and categories">
            <InventoryPage />
          </RequireRole>
        ),
      },
      {
        path: 'borrowers',
        element: (
          <RequireRole roles={PERMISSIONS.manageMasterData} pageName="Borrowers">
            <BorrowersPage />
          </RequireRole>
        ),
      },
      {
        path: 'rooms',
        element: (
          <RequireRole roles={PERMISSIONS.manageMasterData} pageName="Rooms and labs">
            <RoomsPage />
          </RequireRole>
        ),
      },
      {
        path: 'settings',
        element: (
          <RequireRole
            roles={PERMISSIONS.manageSettingsAndSemesters}
            pageName="Settings and semesters"
          >
            <SettingsPage />
          </RequireRole>
        ),
      },
      {
        path: 'reports',
        element: (
          <RequireRole roles={PERMISSIONS.viewDashboardAndReports} pageName="Reports">
            <ReportsPage />
          </RequireRole>
        ),
      },
      { path: 'password', element: <ChangePasswordPage /> }, // every role (SPEC.md 3)
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];
