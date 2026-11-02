import { useId, type ReactNode } from 'react';
import { Dialog, secondaryButtonClass } from './Dialog';

// Asks before a destructive action, such as deleting a category or retiring an item.
// Cancel has focus when it opens, so pressing Enter by accident does not destroy anything.

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  children: ReactNode; // what will happen, in plain words
  confirmLabel: string; // the action, for example "Delete category"
  onConfirm: () => void;
  onCancel: () => void;
  isPending?: boolean; // disables the buttons while the request runs, so it is sent once
};

export function ConfirmDialog(props: ConfirmDialogProps) {
  const bodyId = useId();

  return (
    <Dialog
      open={props.open}
      title={props.title}
      onCancel={props.onCancel}
      isPending={props.isPending}
      describedBy={bodyId}
    >
      <div id={bodyId} className="text-[15px] leading-normal">
        {props.children}
      </div>
      <div className="flex flex-wrap justify-end gap-3">
        <button
          type="button"
          autoFocus
          disabled={props.isPending}
          onClick={props.onCancel}
          className={secondaryButtonClass}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={props.isPending}
          onClick={props.onConfirm}
          className="h-11 cursor-pointer rounded-lg bg-danger px-5 text-base font-semibold text-white transition-opacity duration-150 hover:opacity-90 disabled:cursor-wait disabled:opacity-80"
        >
          {props.confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
