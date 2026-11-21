import { cleanup, render, screen } from '@testing-library/react';
import { lazy, Suspense } from 'react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { PageLoadError } from './PageLoadError';

afterEach(cleanup);

// HRD-5b item 13: a page chunk that cannot be fetched shows the friendly page, not a blank one.
// Built like the app: React.lazy pages inside a Suspense in the layout route (AppShell).
test('TC-HRD-35: a page chunk that fails to load shows a friendly message with Reload', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const Broken = lazy(() =>
    Promise.reject<never>(new TypeError('Failed to fetch dynamically imported module')),
  );
  const router = createMemoryRouter(
    [
      {
        element: (
          <Suspense fallback="Loading…">
            <Outlet />
          </Suspense>
        ),
        errorElement: <PageLoadError />,
        children: [{ path: 'broken', element: <Broken /> }],
      },
    ],
    { initialEntries: ['/broken'] },
  );
  render(<RouterProvider router={router} />);
  expect(await screen.findByText(/This page could not load/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  vi.restoreAllMocks();
});
