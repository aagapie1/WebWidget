import type { Texts } from '../i18n/index.js';

export interface HeaderProps {
  assistantName: string;
  texts: Texts;
  onNewConversation: () => void;
  onHide: () => void;
}

/** Window title and controls. Minimize and X both only hide the window (ADR 004). */
export function Header({ assistantName, texts, onNewConversation, onHide }: HeaderProps) {
  return (
    <header class="header">
      <h1 class="header__title">{assistantName}</h1>
      <div class="header__actions">
        <button type="button" class="button button--text" onClick={onNewConversation}>
          {texts.header.newConversation}
        </button>
        <button
          type="button"
          class="button button--icon"
          aria-label={texts.header.minimize}
          title={texts.header.minimize}
          onClick={onHide}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M5 18h14v2H5z" />
          </svg>
        </button>
        <button
          type="button"
          class="button button--icon"
          aria-label={texts.header.close}
          title={texts.header.close}
          onClick={onHide}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
            <path
              fill="currentColor"
              d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}
