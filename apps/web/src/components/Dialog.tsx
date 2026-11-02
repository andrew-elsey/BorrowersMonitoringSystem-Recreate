import { useEffect, useId, useRef, type ReactNode } from 'react';

// The modal shell shared by ConfirmDialog and FormDialog. It uses the browser's modal <dialog>,
// which keeps keyboard focus inside, closes on Escape, and puts focus back on the button that
// opened it when it closes.

type DialogProps = {
  open: boolean;
  title: string;
  onCancel: () => void;
  isPending?: boolean; // Escape does nothing while the request runs
  describedBy?: string; // id of the text that explains the dialog
  children: ReactNode;
};

export function Dialog(props: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current!;
    if (props.open && !dialog.open) dialog.showModal();
    if (!props.open && dialog.open) dialog.close();
  }, [props.open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={props.describedBy}
      // Escape fires "cancel". The parent decides whether the dialog closes, through `open`.
      onCancel={(event) => {
        event.preventDefault();
        if (!props.isPending) props.onCancel();
      }}
      // Chrome closes the dialog itself on a second Escape, skipping "cancel". Tell the parent,
      // or it keeps `open` true and the dialog can never be opened again.
      onClose={() => {
        if (props.open) props.onCancel();
      }}
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-xl border border-divider bg-surface p-6 text-ink backdrop:bg-ink/40"
    >
      {/* Rendered only while open, so autoFocus runs each time the dialog opens. */}
      {props.open && (
        <div className="flex flex-col gap-4">
          <h2 id={titleId} className="text-xl font-bold">
            {props.title}
          </h2>
          {props.children}
        </div>
      )}
    </dialog>
  );
}

export const secondaryButtonClass =
  'h-11 cursor-pointer rounded-lg border border-field-border px-5 text-base font-medium transition-colors duration-150 hover:bg-page disabled:cursor-wait';
