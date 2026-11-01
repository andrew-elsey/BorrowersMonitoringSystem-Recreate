import { useEffect, useId, useRef, type ReactNode } from 'react';

// Asks before a destructive action, such as deleting a category or retiring an item.
// It uses the browser's modal <dialog>, which keeps keyboard focus inside and closes on Escape.
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = dialogRef.current!;
    if (props.open && !dialog.open) dialog.showModal();
    if (!props.open && dialog.open) dialog.close();
  }, [props.open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      // Escape fires "cancel". The parent decides whether the dialog closes, through `open`.
      onCancel={(event) => {
        event.preventDefault();
        if (!props.isPending) props.onCancel();
      }}
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-xl border border-divider bg-surface p-6 text-ink backdrop:bg-ink/40"
    >
      {/* Rendered only while open, so autoFocus on Cancel runs each time the dialog opens. */}
      {props.open && (
        <div className="flex flex-col gap-4">
          <h2 id={titleId} className="text-xl font-bold">
            {props.title}
          </h2>
          <div id={bodyId} className="text-[15px] leading-normal">
            {props.children}
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              autoFocus
              disabled={props.isPending}
              onClick={props.onCancel}
              className="h-11 cursor-pointer rounded-lg border border-field-border px-5 text-base font-medium transition-colors duration-150 hover:bg-page disabled:cursor-wait"
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
        </div>
      )}
    </dialog>
  );
}
