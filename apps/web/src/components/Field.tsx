import type { ComponentProps } from 'react';

type FieldProps = ComponentProps<'input'> & {
  id: string;
  label: string;
  error?: string;
  hint?: string;
};

// A labeled text input with an optional hint and an inline error.
// shortcut: AUTH-4 only needs text and password inputs; FND-5 builds the shared form components.
export function Field({ id, label, error, hint, ...inputProps }: FieldProps) {
  const describedBy = error || hint ? `${id}-message` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[15px] font-semibold">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`h-11 rounded-lg border bg-surface px-3 text-base text-ink ${error ? 'border-danger' : 'border-field-border'}`}
        {...inputProps}
      />
      {(error || hint) && (
        <p
          id={describedBy}
          className={`text-sm leading-normal ${error ? 'text-danger' : 'text-muted'}`}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
