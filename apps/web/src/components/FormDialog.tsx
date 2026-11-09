import type { FormEventHandler, ReactNode } from 'react';
import { Dialog, secondaryButtonClass } from './Dialog';

// Edits a record in a modal dialog opened from its table row, such as renaming a category.
// The children are the form's fields. When it opens, the browser focuses the first field (no
// autoFocus needed). Enter in a field saves, Escape and Cancel close it, and the browser puts focus
// back on the button that opened it.

type FormDialogProps = {
  open: boolean;
  title: string;
  children: ReactNode; // the fields
  submitLabel: string; // for example "Save name"
  onSubmit: FormEventHandler<HTMLFormElement>; // usually form.handleSubmit(...)
  onCancel: () => void;
  isPending?: boolean; // disables the buttons while the request runs, so it is sent once
  danger?: boolean; // red submit button, as ConfirmDialog has, for an action that is hard to undo
};

export function FormDialog(props: FormDialogProps) {
  return (
    <Dialog
      open={props.open}
      title={props.title}
      onCancel={props.onCancel}
      isPending={props.isPending}
    >
      <form noValidate onSubmit={props.onSubmit} className="flex flex-col gap-4">
        {props.children}
        <div className="flex flex-wrap justify-end gap-3">
          <button
            type="button"
            disabled={props.isPending}
            onClick={props.onCancel}
            className={secondaryButtonClass}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={props.isPending}
            className={`h-11 cursor-pointer rounded-lg px-5 text-base font-semibold text-white transition-colors duration-150 disabled:cursor-wait disabled:opacity-80 ${props.danger ? 'bg-danger hover:opacity-90' : 'bg-primary hover:bg-primary-hover'}`}
          >
            {props.submitLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
