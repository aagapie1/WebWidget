import { useMemo } from 'preact/hooks';
import type { ChatMessage } from '../chat/controller.js';
import type { Texts } from '../i18n/index.js';
import { renderMarkdown } from '../markdown.js';
import { TypingIndicator } from './TypingIndicator.js';

export interface MessageProps {
  message: ChatMessage;
  assistantName: string;
  texts: Texts;
  /** Only the last answer offers a retry button. */
  canRetry: boolean;
  onRetry: () => void;
}

export function Message({ message, assistantName, texts, canRetry, onRetry }: MessageProps) {
  const busy = message.status === 'waiting' || message.status === 'streaming';
  const authorLabel =
    message.author === 'user'
      ? texts.messages.you
      : message.author === 'system'
        ? ''
        : assistantName;

  // Model output is Markdown → sanitized HTML (rule 2). User text is rendered as plain text.
  const html = useMemo(
    () => (message.author === 'user' ? '' : renderMarkdown(message.text)),
    [message.author, message.text],
  );

  return (
    <li class={`message message--${message.author} message--${message.status}`} aria-busy={busy}>
      {authorLabel && <span class="visually-hidden">{authorLabel}: </span>}
      {message.status === 'waiting' && <TypingIndicator label={texts.messages.typing} />}
      {message.author === 'user' ? (
        <p class="message__text">{message.text}</p>
      ) : (
        message.text && <div class="message__text" dangerouslySetInnerHTML={{ __html: html }} />
      )}
      {message.status === 'stopped' && <p class="message__note">{texts.messages.stopped}</p>}
      {message.status === 'error' && message.error && (
        <div class="message__error">
          <p>{message.error.message}</p>
          {canRetry && message.error.retryable && (
            <button type="button" class="button button--secondary" onClick={onRetry}>
              {texts.errors.retry}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
