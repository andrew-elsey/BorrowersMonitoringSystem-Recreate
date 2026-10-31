import { changePasswordSchema, PASSWORD_MIN_LENGTH, type ChangePasswordInput } from '@bms/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';
import { apiFetch, ApiRequestError, errorText, fieldErrors } from '../api';
import { Alert } from '../components/Alert';
import { Field } from '../components/Field';

// The confirm field is checked in the browser only; the API takes { currentPassword, newPassword }.
// It is here because a typo in a masked field would lock the user out until an admin resets it.
const formSchema = changePasswordSchema
  .extend({ confirmPassword: z.string() })
  .refine((form) => form.confirmPassword === form.newPassword, {
    message: 'The two new passwords do not match.',
    path: ['confirmPassword'],
  });
type FormInput = z.infer<typeof formSchema>;

export function ChangePasswordPage() {
  const form = useForm<FormInput>({
    resolver: zodResolver(formSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const change = useMutation({
    mutationFn: (input: ChangePasswordInput) => apiFetch<void>('PUT', '/auth/password', input),
    onSuccess: () => form.reset(),
    onError: (error) => {
      // A wrong current password comes back as a field error (VALIDATION_ERROR details).
      for (const [name, message] of Object.entries(fieldErrors(error))) {
        form.setError(name as keyof FormInput, { message });
      }
    },
  });

  const { errors } = form.formState;
  // Field errors are shown next to their fields; anything else goes in the alert above the form.
  const showFormError = change.isError && Object.keys(fieldErrors(change.error)).length === 0;
  const isWait = change.error instanceof ApiRequestError && change.error.retryAfterSeconds !== null;

  return (
    <>
      <h1 className="text-[28px] leading-tight font-bold">Change password</h1>
      {change.isSuccess && (
        <div className="max-w-[480px]">
          <Alert kind="success">Password changed.</Alert>
        </div>
      )}
      <form
        noValidate
        onSubmit={form.handleSubmit(({ currentPassword, newPassword }) => {
          change.reset();
          change.mutate({ currentPassword, newPassword });
        })}
        className="flex max-w-[480px] flex-col gap-5 rounded-xl border border-divider bg-surface p-7"
      >
        {showFormError && <Alert kind={isWait ? 'wait' : 'error'}>{errorText(change.error)}</Alert>}
        <Field
          id="currentPassword"
          label="Current password"
          type="password"
          autoComplete="current-password"
          error={errors.currentPassword?.message}
          {...form.register('currentPassword')}
        />
        <Field
          id="newPassword"
          label="New password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. Spaces and any characters are allowed.`}
          error={errors.newPassword?.message}
          {...form.register('newPassword')}
        />
        <Field
          id="confirmPassword"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...form.register('confirmPassword')}
        />
        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={change.isPending}
            className="h-11 cursor-pointer rounded-lg bg-primary px-5 text-base font-semibold text-white transition-colors duration-150 hover:bg-primary-hover disabled:cursor-wait disabled:opacity-80"
          >
            {change.isPending ? 'Changing…' : 'Change password'}
          </button>
          <Link
            to="/"
            className="inline-flex h-11 items-center rounded-lg border border-field-border px-5 text-base font-medium text-ink no-underline transition-colors duration-150 hover:bg-page"
          >
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
