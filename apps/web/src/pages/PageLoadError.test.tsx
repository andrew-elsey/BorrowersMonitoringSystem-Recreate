import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, expect, test } from 'vitest';
import { PageLoadError } from './PageLoadError';

afterEach(cleanup);

// HRD-5b item 13: a lazy page whose chunk cannot be fetched shows the friendly page, not a blank one.
test('TC-HRD-35: a page chunk that fails to load shows a friendly message with Reload', async () => {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        errorElement: <PageLoadError />,
        children: [
          {
            path: 'broken',
            lazy: () =>
              Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
          },
        ],
      },
    ],
    { initialEntries: ['/broken'] },
  );
  render(<RouterProvider router={router} />);
  expect(await screen.findByText(/This page could not load/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
});
