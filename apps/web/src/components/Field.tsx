import type { ComponentProps, ReactNode } from 'react';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { fieldErrors } from '../api';

// Shared form fields (FND-5). Each one is labeled, shows a hint or an inline error under it, and
// takes React Hook Form's register() props: <Field id="name" label="Name" {...form.register('name')} />.

type FieldShellProps = { id: string; label: string; error?: string; hint?: string };

// The label, hint, and error around a control. The control points at the message with
// aria-describedby so screen readers read the error with the field.
function FieldShell({
  id,
  label,
  error,
  hint,
  children,
}: FieldShellProps & { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[15px] font-semibold">
        {label}
      </label>
      {children}
      {(error || hint) && (
        <p
          id={`${id}-message`}
          className={`text-sm leading-normal ${error ? 'text-danger' : 'text-muted'}`}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

function controlProps({ id, error, hint }: Omit<FieldShellProps, 'label'>) {
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error || hint ? `${id}-message` : undefined,
    className: `rounded-lg border bg-surface px-3 text-base text-ink ${error ? 'border-danger' : 'border-field-border'}`,
  };
}

type FieldProps = ComponentProps<'input'> & FieldShellProps;

// A text, number, date, or password input.
export function Field({ id, label, error, hint, className, ...inputProps }: FieldProps) {
  const control = controlProps({ id, error, hint });
  return (
    <FieldShell id={id} label={label} error={error} hint={hint}>
      <input
        {...control}
        className={`h-11 ${control.className} ${className ?? ''}`}
        {...inputProps}
      />
    </FieldShell>
  );
}

type SelectFieldProps = ComponentProps<'select'> &
  FieldShellProps & { options: readonly { value: string; label: string }[] };

// A drop-down list. Add a first option with an empty value for "choose one".
export function SelectField({
  id,
  label,
  error,
  hint,
  options,
  className,
  ...selectProps
}: SelectFieldProps) {
  const control = controlProps({ id, error, hint });
  return (
    <FieldShell id={id} label={label} error={error} hint={hint}>
      <select
        {...control}
        className={`h-11 ${control.className} ${className ?? ''}`}
        {...selectProps}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

type TextAreaFieldProps = ComponentProps<'textarea'> & FieldShellProps;

// Multi-line text, such as a description or a note.
export function TextAreaField({
  id,
  label,
  error,
  hint,
  className,
  ...textAreaProps
}: TextAreaFieldProps) {
  const control = controlProps({ id, error, hint });
  return (
    <FieldShell id={id} label={label} error={error} hint={hint}>
      <textarea
        {...control}
        rows={3}
        className={`py-2 ${control.className} ${className ?? ''}`}
        {...textAreaProps}
      />
    </FieldShell>
  );
}

// True when the error has field errors (VALIDATION_ERROR details.fields) and every one belongs to
// a field the form shows. The API keys nested errors by their top-level name, such as "lines", so a
// form may get errors it has no field for; those must be shown as a message instead.
export function fieldErrorsAllShown(error: unknown, shownFields: readonly string[]): boolean {
  const names = Object.keys(fieldErrors(error));
  return names.length > 0 && names.every((name) => shownFields.includes(name));
}

// Puts the API's field errors next to the fields the form shows. Returns false when some error
// has no field (or there are none), so the caller also shows the error message.
export function showApiFieldErrors<T extends FieldValues>(
  setError: UseFormSetError<T>,
  error: unknown,
  shownFields: readonly Path<T>[],
): boolean {
  for (const [name, message] of Object.entries(fieldErrors(error))) {
    if ((shownFields as readonly string[]).includes(name)) setError(name as Path<T>, { message });
  }
  return fieldErrorsAllShown(error, shownFields);
}
