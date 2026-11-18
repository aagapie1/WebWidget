import { useI18n } from '../i18n.js';

export interface PublishBarProps {
  canPublish: boolean;
  errorCount: number;
  hasChanges: boolean;
  saving: boolean;
  conflict: boolean;
  /** Changed sections: shown on the button ("Publică (3)"). */
  changeCount?: number;
  onPublish: () => void;
}

/** Why publishing is not possible right now (shown next to the button), or undefined. */
export function publishBlocker(
  props: Omit<PublishBarProps, 'onPublish'>,
  t: ReturnType<typeof useI18n>['t'],
) {
  if (!props.canPublish) return t.publish.editorOnly;
  if (props.conflict) return t.publish.conflict;
  if (props.errorCount > 0) return t.publish.fixErrors(props.errorCount);
  if (props.saving) return t.publish.waitSave;
  if (!props.hasChanges) return t.publish.nothing;
  return undefined;
}

/**
 * The only primary action. When publishing is not possible it stays focusable (`aria-disabled`)
 * and the reason shows as a tooltip on hover and focus, linked with `aria-describedby`.
 */
export function PublishBar(props: PublishBarProps) {
  const { t } = useI18n();
  const blocker = publishBlocker(props, t);
  const count = props.hasChanges ? (props.changeCount ?? 0) : 0;
  return (
    <div class="publish-bar">
      <button
        type="button"
        class="button button--primary"
        aria-disabled={blocker ? 'true' : undefined}
        aria-describedby={blocker ? 'publish-blocker' : undefined}
        onClick={() => {
          if (!blocker) props.onPublish();
        }}
      >
        {t.ux.publishCount(count)}
      </button>
      {blocker && (
        <span id="publish-blocker" role="tooltip" class="tooltip">
          {blocker}
        </span>
      )}
    </div>
  );
}
