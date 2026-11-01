import { loginSchema } from '@bms/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { afterEach, expect, test } from 'vitest';
import { z } from 'zod';
import { ApiRequestError } from '../api';
import { Field, SelectField, showApiFieldErrors, TextAreaField } from './Field';

afterEach(cleanup);

// A shared schema plus a select and a textarea, the way CRUD screens will use the fields.
const schema = loginSchema.extend({
  type: z.string().min(1, 'Choose a type.'),
  note: z.string().max(5, 'Too long: at most 5 characters.'),
});
type FormInput = z.infer<typeof schema>;

// The API answers every submit with this error (null means success).
function TestForm({ apiError }: { apiError: unknown }) {
  const form = useForm<FormInput>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', password: '', type: '', note: '' },
  });
  const { errors } = form.formState;
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(() => showApiFieldErrors(form.setError, apiError))}
    >
      <Field
        id="username"
        label="Username"
        error={errors.username?.message}
        {...form.register('username')}
      />
      <Field
        id="password"
        label="Password"
        type="password"
        hint="Your own password."
        error={errors.password?.message}
        {...form.register('password')}
      />
      <SelectField
        id="type"
        label="Type"
        options={[
          { value: '', label: 'Choose one' },
          { value: 'STUDENT', label: 'Student' },
        ]}
        error={errors.type?.message}
        {...form.register('type')}
      />
      <TextAreaField
        id="note"
        label="Note"
        error={errors.note?.message}
        {...form.register('note')}
      />
      <button type="submit">Save</button>
    </form>
  );
}

test('schema errors show inline next to each field and are linked to it (TC-FND-22, TC-FND-23)', async () => {
  const user = userEvent.setup();
  render(<TestForm apiError={null} />);

  await user.type(screen.getByLabelText('Note'), 'too long');
  await user.click(screen.getByRole('button', { name: 'Save' }));

  for (const [label, message] of [
    ['Username', 'Enter your username.'],
    ['Password', 'Enter your password.'],
    ['Type', 'Choose a type.'],
    ['Note', 'Too long: at most 5 characters.'],
  ]) {
    const control = screen.getByLabelText(label);
    expect(control.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(control.getAttribute('aria-describedby')!)!.textContent).toBe(
      message,
    );
  }
});

test('a hint shows until there is an error', () => {
  render(<TestForm apiError={null} />);
  const password = screen.getByLabelText('Password');
  expect(password.getAttribute('aria-invalid')).toBeNull();
  expect(document.getElementById(password.getAttribute('aria-describedby')!)!.textContent).toBe(
    'Your own password.',
  );
});

test('field errors from the API details show next to their fields (TC-FND-22)', async () => {
  const user = userEvent.setup();
  const apiError = new ApiRequestError(
    400,
    'VALIDATION_ERROR',
    'Check the highlighted fields.',
    {
      fields: { username: ['That username is taken.'] },
    },
    null,
  );
  render(<TestForm apiError={apiError} />);

  await user.type(screen.getByLabelText('Username'), 'ana');
  await user.type(screen.getByLabelText('Password'), 'secret');
  await user.selectOptions(screen.getByLabelText('Type'), 'STUDENT');
  await user.click(screen.getByRole('button', { name: 'Save' }));

  expect(await screen.findByText('That username is taken.')).toBeTruthy();
  expect(screen.getByLabelText('Username').getAttribute('aria-invalid')).toBe('true');
});

test('showApiFieldErrors returns false for an error without field details', () => {
  const setError = () => {};
  const conflict = new ApiRequestError(409, 'HAS_HISTORY', 'Retire it instead.', {}, null);
  expect(showApiFieldErrors(setError, conflict)).toBe(false);
  expect(showApiFieldErrors(setError, new Error('offline'))).toBe(false);
});

test('every field can be reached and filled with the keyboard (TC-FND-23)', async () => {
  const user = userEvent.setup();
  render(<TestForm apiError={null} />);

  await user.tab();
  expect(document.activeElement).toBe(screen.getByLabelText('Username'));
  await user.tab();
  expect(document.activeElement).toBe(screen.getByLabelText('Password'));
  await user.tab();
  expect(document.activeElement).toBe(screen.getByLabelText('Type'));
  await user.tab();
  expect(document.activeElement).toBe(screen.getByLabelText('Note'));
});
