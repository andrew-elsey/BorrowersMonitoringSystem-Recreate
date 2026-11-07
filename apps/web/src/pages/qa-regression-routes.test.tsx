import { cleanup, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { HANDLER, mockApi, renderApp, signedInAs } from '../test-utils';

// QA regression, Sprints 1 to 3: the Checkout screen (BRW-3) joined the lazy routes of HRD-6 after
// HRD-6's own tests were written. A view-only user must get the "not allowed" page without
// downloading the Checkout chunk. (A handler reaching it through the lazy route is covered by
// CheckoutPage.test.tsx.) One test only: the module cache would make a second one order-dependent.

const chunk = vi.hoisted(() => ({ requested: false }));
vi.mock('./CheckoutPage', () => {
  chunk.requested = true;
  return { CheckoutPage: () => <h1>CheckoutPage stub</h1> };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('a view-only user opening /checkout sees "not allowed", no Checkout menu item, and the Checkout chunk is never requested', async () => {
  mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs({ ...HANDLER, role: 'VIEWER' });
    throw new Error(`unexpected ${method} ${path}`);
  });
  renderApp('/checkout');

  expect(await screen.findByRole('heading', { name: "You can't open this page" })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Checkout' })).toBeNull();
  expect(chunk.requested).toBe(false);
});
