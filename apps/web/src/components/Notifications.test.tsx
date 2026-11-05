import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { ApiRequestError } from '../api';
import { NotificationProvider, useNotify } from './Notifications';

afterEach(cleanup);

// Each button notifies the way a screen would after a save or a failed request.
function Buttons() {
  const notify = useNotify();
  return (
    <>
      <button onClick={() => notify.success('Category saved.')}>Save</button>
      <button
        onClick={() =>
          notify.error(
            new ApiRequestError(
              409,
              'HAS_HISTORY',
              'Cables is used by items. Retire them instead.',
              {},
              null,
            ),
          )
        }
      >
        Delete
      </button>
      <button
        onClick={() =>
          notify.error(
            new ApiRequestError(429, 'RATE_LIMITED', 'Too many requests. Try again later.', {}, 12),
          )
        }
      >
        Spam
      </button>
      <button onClick={() => notify.error(new TypeError('Failed to fetch'))}>Offline</button>
    </>
  );
}

function renderWithProvider() {
  render(
    <NotificationProvider>
      <Buttons />
    </NotificationProvider>,
  );
  return userEvent.setup();
}

test('a success notification is shown as a status message (TC-FND-26)', async () => {
  const user = renderWithProvider();
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByRole('status').textContent).toContain('Category saved.');
});

test('an error notification shows the API error message (TC-FND-26)', async () => {
  const user = renderWithProvider();
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  expect(screen.getByRole('alert').textContent).toContain(
    'Cables is used by items. Retire them instead.',
  );
});

test('a 429 says how long to wait, from Retry-After', async () => {
  const user = renderWithProvider();
  await user.click(screen.getByRole('button', { name: 'Spam' }));
  expect(screen.getByRole('alert').textContent).toContain(
    'Too many requests. Try again in 12 seconds.',
  );
});

test('a network failure gets a plain message', async () => {
  const user = renderWithProvider();
  await user.click(screen.getByRole('button', { name: 'Offline' }));
  expect(screen.getByRole('alert').textContent).toContain(
    'Could not reach the server. Please try again.',
  );
});

test('messages stay until dismissed, one at a time (TC-FND-23)', async () => {
  const user = renderWithProvider();
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(2);

  await user.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]!);
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('alert')).toBeTruthy();
});

test('only the newest three messages are kept, so they never cover the screen', async () => {
  const user = renderWithProvider();
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  for (let i = 0; i < 3; i++) await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(3);
  expect(screen.queryByRole('alert')).toBeNull(); // the oldest, the error, was dropped
});

test('messages appear inside a live region that is always on the page', () => {
  renderWithProvider();
  expect(document.querySelector('[aria-live="polite"]')).toBeTruthy();
});

test('TC-BRW-39: the message area is pinned, and focused fields scroll in below it', async () => {
  const user = renderWithProvider();
  const area = document.querySelector<HTMLElement>('[aria-live="polite"]')!;
  // Sticky (in the page flow, so it never covers the top bar), with a background of its own.
  expect(area.className).toMatch(/\bsticky top-0\b/);
  expect(area.className).toMatch(/\bbg-page\b/);
  // jsdom has no layout, so the height is faked.
  Object.defineProperty(area, 'offsetHeight', { configurable: true, value: 64 });
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(document.documentElement.style.scrollPaddingTop).toBe('64px');
  await user.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(document.documentElement.style.scrollPaddingTop).toBe('0px');
});

test('useNotify outside the provider fails clearly', () => {
  expect(() => render(<Buttons />)).toThrow('useNotify needs a NotificationProvider above it');
});
