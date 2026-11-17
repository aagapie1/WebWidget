import type { Texts } from '../i18n/index.js';
import { AssistantIcon, ChevronDownIcon, CloseIcon, NewChatIcon } from './icons.js';

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
      <div class="header__bar">
        <span class="avatar avatar--large" aria-hidden="true">
          <AssistantIcon size={22} />
        </span>
        <div class="header__titles">
          <h1 class="header__title">{assistantName}</h1>
          <p class="header__subtitle">
            <span class="status-dot" aria-hidden="true" />
            {texts.header.subtitle}
          </p>
        </div>
        <div class="header__actions">
          <button
            type="button"
            class="icon-button"
            aria-label={texts.header.newConversation}
            title={texts.header.newConversation}
            onClick={onNewConversation}
          >
            <NewChatIcon />
          </button>
          <button
            type="button"
            class="icon-button"
            aria-label={texts.header.minimize}
            title={texts.header.minimize}
            onClick={onHide}
          >
            <ChevronDownIcon />
          </button>
          <button
            type="button"
            class="icon-button"
            aria-label={texts.header.close}
            title={texts.header.close}
            onClick={onHide}
          >
            <CloseIcon />
          </button>
        </div>
      </div>
      <svg class="header__wave" viewBox="0 0 400 24" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 24V10C70 22 140 24 210 14S340 0 400 8v16z" />
      </svg>
    </header>
  );
}
