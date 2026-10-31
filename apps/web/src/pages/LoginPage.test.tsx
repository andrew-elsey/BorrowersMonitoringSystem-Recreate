import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { apiError, HANDLER, mockApi, renderApp, signedInAs, signedOut } from '../test-utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function signIn(username: string, password: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Username'), username);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

test('a signed-out user is sent to login, signs in, and sees home with their name and role', async () => {
  const fetchMock = mockApi((method, path) => {
    if (path === '/auth/me') return signedOut;
    if (method === 'POST' && path === '/auth/login') return signedInAs(HANDLER);
    throw new Error(`unexpected ${method} ${path}`);
  });
  const router = renderApp('/');

  await signIn('jdelacruz', 'correct-horse-battery');

  expect(await screen.findByRole('heading', { name: 'Home' })).toBeTruthy();
  expect(router.state.location.pathname).toBe('/');
  expect(screen.getByText('Handler', { selector: 'span' })).toBeTruthy();
  // AUTH-4: only built screens are in the menu, and only the ones this role may use.
  const menu = screen.getByRole('navigation', { name: 'Main' });
  expect([...menu.querySelectorAll('a')].map((link) => link.textContent)).toEqual(['Home']);
  const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/auth/login')!;
  expect(JSON.parse(init!.body as string)).toEqual({
    username: 'jdelacruz',
    password: 'correct-horse-battery',
  });
  expect((init!.headers as Record<string, string>)['X-Requested-With']).toBe('fetch');
});

test('empty fields are caught in the browser without calling the API', async () => {
  const fetchMock = mockApi(() => signedOut);
  renderApp('/login');

  await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));

  expect(await screen.findByText('Enter your username.')).toBeTruthy();
  expect(screen.getByText('Enter your password.')).toBeTruthy();
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/auth/me']);
});

test('a failed login shows the generic error from the API and clears the password', async () => {
  mockApi((method, path) => {
    if (path === '/auth/me') return signedOut;
    return { status: 401, body: apiError('UNAUTHENTICATED', 'Incorrect username or password.') };
  });
  renderApp('/login');

  await signIn('jdelacruz', 'wrong-password');

  expect((await screen.findByRole('alert')).textContent).toBe('Incorrect username or password.');
  expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('jdelacruz');
});

test('a throttled login (429) says how long to wait, from Retry-After', async () => {
  mockApi((method, path) => {
    if (path === '/auth/me') return signedOut;
    return {
      status: 429,
      headers: { 'Retry-After': '42' },
      body: apiError('RATE_LIMITED', 'Too many failed sign-in attempts. Try again later.'),
    };
  });
  renderApp('/login');

  await signIn('jdelacruz', 'wrong-password');

  expect((await screen.findByRole('alert')).textContent).toBe(
    'Too many failed sign-in attempts. Try again in 42 seconds.',
  );
});

test('a busy server (503) says how long to wait, from Retry-After', async () => {
  mockApi((method, path) => {
    if (path === '/auth/me') return signedOut;
    return {
      status: 503,
      headers: { 'Retry-After': '5' },
      body: apiError('SERVER_BUSY', 'The server is busy. Try again in a few seconds.'),
    };
  });
  renderApp('/login');

  await signIn('jdelacruz', 'correct-horse-battery');

  expect((await screen.findByRole('alert')).textContent).toBe(
    'The server is busy. Try again in 5 seconds.',
  );
});

test('a reload keeps the user signed in: the user comes from GET /api/auth/me', async () => {
  mockApi(() => signedInAs(HANDLER));
  renderApp('/');

  expect(await screen.findByRole('heading', { name: 'Home' })).toBeTruthy();
  expect(screen.getAllByText('Juan dela Cruz').length).toBeGreaterThan(0);
});

test('sign out ends the session and returns to the login page', async () => {
  let signedIn = true;
  const fetchMock = mockApi((method, path) => {
    if (path === '/auth/me') return signedIn ? signedInAs(HANDLER) : signedOut;
    if (method === 'POST' && path === '/auth/logout') {
      signedIn = false;
      return { status: 204 };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
  const router = renderApp('/');

  await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
  expect(router.state.location.pathname).toBe('/login');
  expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/logout')).toBe(true);
});

test('after a deliberate sign out, the next sign-in lands on home, not the last page', async () => {
  let signedIn = true;
  mockApi((method, path) => {
    if (path === '/auth/me') return signedIn ? signedInAs(HANDLER) : signedOut;
    if (path === '/auth/logout') {
      signedIn = false;
      return { status: 204 };
    }
    if (path === '/auth/login') return signedInAs(HANDLER);
    throw new Error(`unexpected ${method} ${path}`);
  });
  const router = renderApp('/password');

  await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
  await signIn('jdelacruz', 'a-brand-new-password');

  expect(await screen.findByRole('heading', { name: 'Home' })).toBeTruthy();
  expect(router.state.location.pathname).toBe('/');
});

test('when the session expires, signing in again returns to the page the user was on', async () => {
  mockApi((method, path) => {
    if (path === '/auth/me') return signedOut;
    if (path === '/auth/login') return signedInAs(HANDLER);
    throw new Error(`unexpected ${method} ${path}`);
  });
  const router = renderApp('/password');

  await signIn('jdelacruz', 'correct-horse-battery');

  expect(await screen.findByRole('heading', { name: 'Change password' })).toBeTruthy();
  expect(router.state.location.pathname).toBe('/password');
});
