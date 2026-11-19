import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { useI18n } from '../i18n.js';
import { ConfirmDialog } from './ConfirmDialog.js';

interface OriginsListProps {
  origins: readonly string[];
  /** Errors per position in `origins` (`allowedOrigins.<n>`). */
  errorsAt: (index: number) => readonly string[] | undefined;
  /** Errors of the whole list (e.g. empty). */
  listErrors?: readonly string[] | undefined;
  onChange: (origins: string[]) => void;
}

/**
 * Allowed domains as a list (E4b.1 UX 14): one field per domain, validated on its own row,
 * "Adaugă domeniu", and "Elimină" with a confirmation, since removing a domain stops the
 * assistant on that site once published. Empty rows stay on screen and are not sent.
 */
export function OriginsList({ origins, errorsAt, listErrors, onChange }: OriginsListProps) {
  const { t } = useI18n();
  const id = useId();
  const [rows, setRows] = useState<string[]>(() => (origins.length > 0 ? [...origins] : ['']));
  const [removing, setRemoving] = useState<number | undefined>();
  const focusRow = useRef<number | undefined>(undefined);
  const addButton = useRef<HTMLButtonElement>(null);

  // A discarded draft or a reloaded configuration replaces the list.
  const sent = useRef(origins.join('\n'));
  useEffect(() => {
    if (origins.join('\n') === sent.current) return;
    sent.current = origins.join('\n');
    setRows(origins.length > 0 ? [...origins] : ['']);
  }, [origins]);

  useEffect(() => {
    if (focusRow.current === undefined) return;
    const target =
      focusRow.current < 0
        ? addButton.current
        : document.getElementById(`${id}-${String(focusRow.current)}`);
    focusRow.current = undefined;
    target?.focus();
  });

  const update = (next: string[]) => {
    setRows(next);
    const list = next.map((row) => row.trim()).filter(Boolean);
    sent.current = list.join('\n');
    onChange(list);
  };
  /** Position of a row in the list that is sent (empty rows are left out). */
  const sentIndex = (row: number) => rows.slice(0, row).filter((value) => value.trim()).length;

  const remove = (row: number) => {
    const next = rows.filter((_, index) => index !== row);
    focusRow.current = next.length === 0 ? 0 : Math.min(row, next.length - 1);
    update(next.length > 0 ? next : ['']);
  };

  return (
    <div class="origins" role="group" aria-labelledby={`${id}-label`}>
      <span class="field__label" id={`${id}-label`}>
        {t.fields.origins}
      </span>
      <p class="field__hint" id={`${id}-hint`}>
        {t.fields.originsHint}
      </p>
      {listErrors && listErrors.length > 0 && (
        <ul class="field__errors">
          {listErrors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      <ol class="origins__list">
        {rows.map((row, index) => {
          const errors = row.trim() ? errorsAt(sentIndex(index)) : undefined;
          const invalid = Boolean(errors && errors.length > 0);
          const inputId = `${id}-${String(index)}`;
          return (
            <li key={index} class={invalid ? 'origins__row field--invalid' : 'origins__row'}>
              <label class="visually-hidden" for={inputId}>
                {t.fields.originLabel(index + 1)}
              </label>
              <input
                id={inputId}
                type="text"
                inputMode="url"
                spellcheck={false}
                placeholder="https://"
                value={row}
                aria-invalid={invalid}
                aria-describedby={[invalid ? `${inputId}-error` : '', `${id}-hint`]
                  .filter(Boolean)
                  .join(' ')}
                onInput={(event) => {
                  const next = [...rows];
                  next[index] = event.currentTarget.value;
                  update(next);
                }}
              />
              <button
                type="button"
                class="button button--quiet"
                aria-label={t.fields.removeOrigin(index + 1, row.trim())}
                onClick={() => {
                  if (row.trim()) setRemoving(index);
                  else remove(index);
                }}
              >
                {t.fields.remove}
              </button>
              {invalid && (
                <ul id={`${inputId}-error`} class="field__errors">
                  {errors?.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      <button
        ref={addButton}
        type="button"
        class="button"
        onClick={() => {
          focusRow.current = rows.length;
          setRows([...rows, '']);
        }}
      >
        {t.fields.addOrigin}
      </button>
      {removing !== undefined && (
        <ConfirmDialog
          title={t.fields.removeOriginTitle}
          body={t.fields.removeOriginBody(rows[removing]?.trim() ?? '')}
          confirmLabel={t.fields.removeOriginConfirm}
          cancelLabel={t.publish.cancel}
          onConfirm={() => {
            const row = removing;
            setRemoving(undefined);
            remove(row);
          }}
          onCancel={() => {
            focusRow.current = removing;
            setRemoving(undefined);
          }}
        />
      )}
    </div>
  );
}
