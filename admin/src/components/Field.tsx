import type { ComponentChildren } from 'preact';
import { useId, useState } from 'preact/hooks';
import { useI18n } from '../i18n.js';

export interface FieldProps {
  label: string;
  hint?: string | undefined;
  errors?: readonly string[] | undefined;
  /** Renders the control with the ids it must use for its label and descriptions. */
  children: (ids: {
    id: string;
    describedBy: string | undefined;
    invalid: boolean;
  }) => ComponentChildren;
}

/**
 * Label, hint and errors for one control (spec §7): errors are next to the field and linked
 * through `aria-describedby`; the control gets `aria-invalid`.
 */
export function Field({ label, hint, errors = [], children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = errors.length > 0 ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div class={errors.length > 0 ? 'field field--invalid' : 'field'}>
      <label for={id}>{label}</label>
      {children({ id, describedBy, invalid: errors.length > 0 })}
      {errors.length > 0 && (
        <ul id={errorId} class="field__errors">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      {hint && (
        <p id={hintId} class="field__hint">
          {hint}
        </p>
      )}
    </div>
  );
}

interface TextFieldProps {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  hint?: string | undefined;
  errors?: readonly string[] | undefined;
  placeholder?: string | undefined;
  multiline?: boolean;
  type?: 'text' | 'url';
  readOnly?: boolean;
}

/** An emptied text field removes the value, so the default applies. */
export function TextField(props: TextFieldProps) {
  const update = (event: Event) => {
    const value = (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;
    props.onChange(value === '' ? undefined : value);
  };
  return (
    <Field label={props.label} hint={props.hint} errors={props.errors}>
      {({ id, describedBy, invalid }) =>
        props.multiline ? (
          <textarea
            id={id}
            rows={3}
            value={props.value ?? ''}
            placeholder={props.placeholder}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            readOnly={props.readOnly}
            onInput={update}
          />
        ) : (
          <input
            id={id}
            type="text"
            inputMode={props.type === 'url' ? 'url' : undefined}
            value={props.value ?? ''}
            placeholder={props.placeholder}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            readOnly={props.readOnly}
            onInput={update}
          />
        )
      }
    </Field>
  );
}

interface NumberFieldProps {
  label: string;
  value: number | undefined;
  /** The value used when none is set: shown as the value, and named in the help text. */
  defaultValue: number;
  min: number;
  max: number;
  onChange: (value: number | undefined) => void;
  errors?: readonly string[] | undefined;
}

/**
 * Shows the value in effect (set, or the default) as normal text — never a grey placeholder —
 * and the default only in the help text (E4b.1 UX). Emptying the field returns to the default.
 */
export function NumberField(props: NumberFieldProps) {
  const { t } = useI18n();
  const [text, setText] = useState(String(props.value ?? props.defaultValue));
  return (
    <Field label={props.label} errors={props.errors} hint={t.ux.defaultIs(props.defaultValue)}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={props.min}
          max={props.max}
          step={1}
          value={text}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          onInput={(event) => {
            const raw = event.currentTarget.value;
            setText(raw);
            props.onChange(raw === '' ? undefined : Number(raw));
          }}
          onBlur={() => {
            if (text === '') setText(String(props.defaultValue));
          }}
        />
      )}
    </Field>
  );
}

interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  errors?: readonly string[] | undefined;
}

export function SelectField<T extends string>(props: SelectFieldProps<T>) {
  return (
    <Field label={props.label} errors={props.errors}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          value={props.value}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          onChange={(event) => {
            props.onChange(event.currentTarget.value as T);
          }}
        >
          {props.options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

interface CheckboxFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string | undefined;
}

export function CheckboxField(props: CheckboxFieldProps) {
  const id = useId();
  return (
    <div class="field field--checkbox">
      <input
        id={id}
        type="checkbox"
        checked={props.checked}
        aria-describedby={props.hint ? `${id}-hint` : undefined}
        onChange={(event) => {
          props.onChange(event.currentTarget.checked);
        }}
      />
      <label for={id}>{props.label}</label>
      {props.hint && (
        <p id={`${id}-hint`} class="field__hint">
          {props.hint}
        </p>
      )}
    </div>
  );
}
