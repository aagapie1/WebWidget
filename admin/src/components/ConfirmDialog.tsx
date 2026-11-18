import { useEffect, useId, useRef } from 'preact/hooks';

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Modal confirmation (native dialog: focus trapped while open, returned on close, Escape). */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const opener = document.activeElement as HTMLElement | null;
    if (typeof element.showModal === 'function') element.showModal();
    else element.setAttribute('open', '');
    return () => {
      opener?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      class="dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      onCancel={(event) => {
        event.preventDefault();
        props.onCancel();
      }}
    >
      <h2 id={`${id}-title`}>{props.title}</h2>
      <p id={`${id}-body`}>{props.body}</p>
      <div class="dialog__actions">
        <button type="button" class="button" onClick={props.onCancel}>
          {props.cancelLabel}
        </button>
        <button
          type="button"
          class="button button--danger"
          aria-disabled={props.busy ? 'true' : undefined}
          onClick={() => {
            if (!props.busy) props.onConfirm();
          }}
        >
          {props.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
