import { useI18n } from '../i18n.js';
import { Field } from './Field.js';

const HEX = /^#[0-9a-fA-F]{6}$/;

interface ColorFieldProps {
  label: string;
  /** The stored value; undefined means the default. */
  value: string | undefined;
  /** The color used when no value is set (shown in the swatch). */
  fallback: string;
  onChange: (value: string | undefined) => void;
  errors?: readonly string[] | undefined;
}

/** A color picker plus the same value as text (keyboard and screen reader friendly). */
export function ColorField({ label, value, fallback, onChange, errors }: ColorFieldProps) {
  const { t } = useI18n();
  const shown = value && HEX.test(value) ? value : fallback;
  return (
    <Field
      label={label}
      errors={errors}
      hint={value ? undefined : `${t.fields.colorDefault}: ${fallback}`}
    >
      {({ id, describedBy, invalid }) => (
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
            aria-describedby={describedBy}
            aria-invalid={invalid}
            onInput={(event) => {
              const raw = event.currentTarget.value.trim();
              onChange(raw === '' ? undefined : raw);
            }}
          />
          {value !== undefined && (
            <button
              type="button"
              class="button button--quiet"
              onClick={() => {
                onChange(undefined);
              }}
            >
              {t.fields.reset}
            </button>
          )}
        </div>
      )}
    </Field>
  );
}
