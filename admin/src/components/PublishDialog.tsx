import { useEffect, useRef, useState } from 'preact/hooks';
import { useI18n } from '../i18n.js';

interface PublishDialogProps {
  nextVersion: number;
  /** Section keys (see model.SECTION_ORDER) changed against the published version. */
  sections: readonly string[];
  busy: boolean;
  error: string | undefined;
  onConfirm: (comment: string) => void;
  onCancel: () => void;
}

/** Publish confirmation with the changed sections (request 4); diffs come in E4b.2. */
export function PublishDialog(props: PublishDialogProps) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [comment, setComment] = useState('');

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
      aria-labelledby="publish-title"
      aria-describedby="publish-intro"
      onCancel={(event) => {
        event.preventDefault();
        props.onCancel();
      }}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (!props.busy) props.onConfirm(comment.trim());
        }}
      >
        <h2 id="publish-title">{t.publish.dialogTitle}</h2>
        <p id="publish-intro">{t.publish.dialogIntro(props.nextVersion)}</p>
        <h3>{t.publish.changed}</h3>
        <ul class="dialog__sections">
          {props.sections.map((section) => (
            <li key={section}>{t.sections[section] ?? section}</li>
          ))}
        </ul>
        <label for="publish-comment">{t.publish.comment}</label>
        <textarea
          id="publish-comment"
          rows={2}
          maxLength={500}
          value={comment}
          onInput={(event) => {
            setComment(event.currentTarget.value);
          }}
        />
        {props.error && (
          <p class="field__errors" role="alert">
            {props.error}
          </p>
        )}
        <div class="dialog__actions">
          <button type="button" class="button" onClick={props.onCancel}>
            {t.publish.cancel}
          </button>
          <button
            type="submit"
            class="button button--primary"
            aria-disabled={props.busy ? 'true' : undefined}
          >
            {t.publish.confirm}
          </button>
        </div>
      </form>
    </dialog>
  );
}
