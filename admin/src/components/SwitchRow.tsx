import type { ComponentChildren } from 'preact';
import { useId } from 'preact/hooks';
import type { IconNode } from 'widget/icons';
import { NodeIcon } from './OptionGrid.js';

interface SwitchRowProps {
  icon: IconNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Settings of the feature, shown under the row only when it is on. */
  children?: ComponentChildren;
}

/**
 * An optional feature as a row (like the Dify console): icon, title, one sentence and a switch
 * (`role="switch"`, named by the title, described by the sentence).
 */
export function SwitchRow({
  icon,
  title,
  description,
  checked,
  onChange,
  children,
}: SwitchRowProps) {
  const id = useId();
  return (
    <div class="switch-row">
      <div class="switch-row__main">
        <span class="switch-row__icon" aria-hidden="true">
          <NodeIcon node={icon} size={18} />
        </span>
        <div class="switch-row__text">
          <span class="switch-row__title" id={`${id}-title`}>
            {title}
          </span>
          <span class="switch-row__description" id={`${id}-description`}>
            {description}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          class="switch"
          aria-checked={checked}
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-description`}
          onClick={() => {
            onChange(!checked);
          }}
        >
          <span class="switch__knob" />
        </button>
      </div>
      {checked && children && <div class="switch-row__settings">{children}</div>}
    </div>
  );
}
