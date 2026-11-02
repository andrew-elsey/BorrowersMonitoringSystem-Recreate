import { expect, test } from 'vitest';

// QA round 3: emulateModalDialogs() patches HTMLDialogElement.prototype.
// This file never calls it, so the patch from other files must not be visible here.
test('the modal dialog emulation does not leak into a file that did not install it', () => {
  const showModal = HTMLDialogElement.prototype.showModal;
  expect(showModal === undefined || !String(showModal).includes('opener')).toBe(true);
});
