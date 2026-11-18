import { useId } from 'preact/hooks';
import { useI18n } from '../i18n.js';
import { Field } from './Field.js';

const HEX = /^#[0-9a-fA-F]{6}$/;

interface ColorFieldProps {
  label: string;
  /** The stored value; undefined means the default or automatic color. */
  value: string | undefined;
  /** The color used when no value is set (shown in the swatch and the hint). */
  fallback: string;
  /**
   * The fallback is computed from other colors (E4b.1 UX 9): shown as "Automat: #…", with
   * "Fixează valoarea" to keep it, and "Revino la automat" once a value is set.
   */
  automatic?: boolean;
  onChange: (value: string | undefined) => void;
  errors?: readonly string[] | undefined;
}

/** A color picker plus the same value as text (keyboard and screen reader friendly). */
export function ColorField({
  label,
  value,
  fallback,
  automatic = false,
  onChange,
  errors,
}: ColorFieldProps) {
  const { t } = useI18n();
  const noteId = useId();
  const shown = value && HEX.test(value) ? value : fallback;
  // One line under the field: what applies when empty, then the action.
  const action =
    value !== undefined
      ? {
          text: automatic ? t.fields.backToAuto : t.fields.reset,
          run: () => {
            onChange(undefined);
          },
        }
      : automatic
        ? {
            text: t.fields.pinColor,
            run: () => {
              onChange(fallback);
            },
          }
        : undefined;
  return (
    <Field label={label} errors={errors}>
      {({ id, describedBy, invalid }) => (
        <>
          <div class="color">
            <input
              type="color"
              class="color__swatch"
              value={shown.toLowerCase()}
              aria-label={`${label} (${t.fields.colors})`}
              tabIndex={-1}
              onInput={(event) => {
                onChange(event.currentTarget.value);
              }}
            />
            <input
              id={id}
              type="text"
              class="color__text"
              spellcheck={false}
              autoComplete="off"
              value={value ?? ''}
              placeholder={fallback}
              aria-describedby={
                [describedBy, value ? '' : noteId].filter(Boolean).join(' ') || undefined
              }
              aria-invalid={invalid}
              onInput={(event) => {
                const raw = event.currentTarget.value.trim();
                onChange(raw === '' ? undefined : raw);
              }}
            />
          </div>
          <p class="field__hint color__note">
            {!value && (
              <span id={noteId}>
                {automatic ? t.fields.colorAuto : t.fields.colorDefault}: {fallback}
              </span>
            )}
            {action && (
              <button
                type="button"
                class="color__action"
                aria-label={`${action.text}: ${label}`}
                onClick={action.run}
              >
                {action.text}
              </button>
            )}
          </p>
        </>
      )}
    </Field>
  );
}
