import type { Texts } from '../i18n/index.js';
import { AssistantIcon, CheckCircleIcon, ChevronDownIcon, ListIcon } from './icons.js';

export interface HeaderProps {
  assistantName: string;
  texts: Texts;
  /** Shows "Închide conversația" only when there is a conversation to close. */
  canClose: boolean;
  onShowConversations: () => void;
  onCloseConversation: () => void;
  onHide: () => void;
}

/** Window title and controls. Minimize hides the window and keeps the conversation (ADR 004). */
export function Header({
  assistantName,
  texts,
  canClose,
  onShowConversations,
  onCloseConversation,
  onHide,
}: HeaderProps) {
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
            aria-label={texts.header.conversations}
            title={texts.header.conversations}
            onClick={onShowConversations}
          >
            <ListIcon />
          </button>
          {canClose && (
            <button
              type="button"
              class="icon-button"
              aria-label={texts.header.closeConversation}
              title={texts.header.closeConversation}
              onClick={onCloseConversation}
            >
              <CheckCircleIcon />
            </button>
          )}
          <button
            type="button"
            class="icon-button"
            aria-label={texts.header.minimize}
            title={texts.header.minimize}
            onClick={onHide}
          >
            <ChevronDownIcon />
          </button>
        </div>
      </div>
      <svg class="header__wave" viewBox="0 0 400 24" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 24V10C70 22 140 24 210 14S340 0 400 8v16z" />
      </svg>
    </header>
  );
}
