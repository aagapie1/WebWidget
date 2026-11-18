import { h, type ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';
import type { IconNode } from 'widget/icons';

export interface GridOption<T extends string> {
  value: T;
  label: string;
  /** What the option looks like (decorative: the label names it). */
  visual: ComponentChildren;
}

interface OptionGridProps<T extends string> {
  legend: string;
  hint?: string | undefined;
  value: T;
  options: readonly GridOption<T>[];
  onChange: (value: T) => void;
}

/**
 * A visual choice (icons, avatars): a native radio group, so arrow keys move the selection and
 * screen readers announce "1 of 8"; the selected tile is highlighted.
 */
export function OptionGrid<T extends string>(props: OptionGridProps<T>) {
  const name = useId();
  const hintId = props.hint ? `${name}-hint` : undefined;
  return (
    <fieldset class="field option-grid" aria-describedby={hintId}>
      <legend>{props.legend}</legend>
      <div class="option-grid__tiles">
        {props.options.map((option) => {
          const selected = option.value === props.value;
          return (
            <label key={option.value} class={selected ? 'tile tile--selected' : 'tile'}>
              <input
                type="radio"
                class="tile__input"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => {
                  props.onChange(option.value);
                }}
              />
              <span class="tile__visual" aria-hidden="true">
                {option.visual}
              </span>
              <span class="tile__label">{option.label}</span>
            </label>
          );
        })}
      </div>
      {props.hint && (
        <p id={hintId} class="field__hint">
          {props.hint}
        </p>
      )}
    </fieldset>
  );
}

/** A bundled icon (Lucide data, shared with the widget). */
export function NodeIcon({ node, size = 24 }: { node: IconNode; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {node.map(([tag, attributes], index) => h(tag, { key: index, ...attributes }))}
    </svg>
  );
}
