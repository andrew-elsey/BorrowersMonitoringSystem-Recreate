import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { apiError, HANDLER, mockApi, renderApp, signedInAs } from '../test-utils';

// QA gap test for FND-7 on a real screen: TC-FND-30 only uses a test form.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('change password: a wrong current password from the API moves focus to Current password and is announced', async () => {
  const message = 'The current password is incorrect.';
  mockApi((method, path) => {
    if (path === '/auth/me') return signedInAs(HANDLER);
    if (method === 'PUT' && path === '/auth/password') {
      return {
        status: 400,
        body: apiError('VALIDATION_ERROR', 'Check the highlighted fields.', {
          fields: { currentPassword: [message] },
        }),
      };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
  const user = userEvent.setup();
  renderApp('/password');

  await user.type(await screen.findByLabelText('Current password'), 'wrong-password-1');
  await user.type(screen.getByLabelText('New password'), 'a longer phrase');
  // Submit with Enter from the last field, so focus has to move back to the first one.
  await user.type(screen.getByLabelText('Confirm new password'), 'a longer phrase{Enter}');

  const error = await screen.findByText(message);
  expect(error.getAttribute('role')).toBe('alert');
  expect(document.activeElement).toBe(screen.getByLabelText('Current password'));
});
