import { PERMISSIONS, type Role } from '@bms/shared';
import type { ReactNode } from 'react';
import { Navigate, useLocation, type RouteObject } from 'react-router';
import { AppShell } from './AppShell';
import { useAuth } from './auth';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { NotAllowedPage } from './pages/NotAllowedPage';

// Route guard: signed-out users go to the login page. After an expired session, login sends them
// back to this page; after Sign out it sends them home.
function RequireSignIn({ children }: { children: ReactNode }) {
  const { user, signedOutOnPurpose } = useAuth();
  const location = useLocation();
  if (!user) {
    const state = signedOutOnPurpose ? undefined : { from: location.pathname };
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
          <RequireRole roles={PERMISSIONS.viewDashboardAndReports} pageName="Home">
            <HomePage />
          </RequireRole>
        ),
      },
      { path: 'password', element: <ChangePasswordPage /> }, // every role (SPEC.md 3)
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];
