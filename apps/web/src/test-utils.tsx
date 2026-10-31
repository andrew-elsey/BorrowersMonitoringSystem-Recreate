import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { routes } from './App';
import { AuthProvider, createQueryClient, type SignedInUser } from './auth';

export const HANDLER: SignedInUser = {
  id: 'u1',
  name: 'Juan dela Cruz',
  username: 'jdelacruz',
  role: 'HANDLER',
};

type FakeResponse = { status: number; body?: unknown; headers?: Record<string, string> };
type Handler = (method: string, path: string, body: unknown) => FakeResponse;

// Replaces fetch with a fake API. The handler gets paths without the /api prefix.
export function mockApi(handler: Handler) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const response = handler(init.method ?? 'GET', url.replace(/^\/api/, ''), body);
    const json = response.body === undefined ? null : JSON.stringify(response.body);
    return new Response(json, { status: response.status, headers: response.headers });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// The /me answers for a signed-out and a signed-in browser.
export const signedOut = { status: 401, body: apiError('UNAUTHENTICATED', 'Please sign in.') };
export const signedInAs = (user: SignedInUser) => ({ status: 200, body: { user } });

export function apiError(code: string, message: string, details = {}) {
  return { error: { code, message, details } };
}

// The whole app at `path`, the way main.tsx builds it, with a router that lives in memory.
export function renderApp(path = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return router;
}
