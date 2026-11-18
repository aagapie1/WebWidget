import { formatTime, useI18n } from '../i18n.js';

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  | { kind: 'error' }
  | { kind: 'conflict' }
  | { kind: 'published'; version: number };

/** Save indicator, announced politely to screen readers (spec §7, request 5). */
export function SaveStatus({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const { t, locale } = useI18n();
  let text = '';
  switch (state.kind) {
    case 'idle':
      text = t.save.idle;
      break;
    case 'pending':
      text = t.save.pending;
      break;
    case 'saving':
      text = t.save.saving;
      break;
    case 'saved':
      text = t.save.saved(formatTime(state.at, locale));
      break;
    case 'error':
      text = t.save.error;
      break;
    case 'conflict':
      text = t.conflict.title;
      break;
    case 'published':
      text = t.save.published(state.version);
      break;
  }
  return (
    <div class={`save-status save-status--${state.kind}`}>
      <p role="status" aria-live="polite" aria-atomic="true">
        {text}
      </p>
      {state.kind === 'error' && (
        <button type="button" class="button button--quiet" onClick={onRetry}>
          {t.save.retry}
        </button>
      )}
    </div>
  );
}
