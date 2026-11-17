import { useEffect, useRef } from 'preact/hooks';
import type { ChatMessage } from '../chat/controller.js';
import type { Texts } from '../i18n/index.js';
import { Message } from './Message.js';

export interface MessageListProps {
  messages: readonly ChatMessage[];
  assistantName: string;
  texts: Texts;
  onRetry: () => void;
}

/**
 * No aria-live here: streamed deltas would be read piece by piece. Completed answers are
 * announced once by <Announcer> (ADR 004).
 */
export function MessageList({ messages, assistantName, texts, onRetry }: MessageListProps) {
  const scroller = useRef<HTMLElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const element = scroller.current;
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const element = scroller.current;
    if (!element) return;
    // Follow new text only while the reader is at the bottom.
    stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
  };

  const last = messages.at(-1);
  return (
    // Focusable so keyboard users can scroll long conversations (scrollable region).
    <section
      class="messages"
      aria-label={texts.messages.label}
      ref={scroller}
      onScroll={onScroll}
      tabIndex={0}
    >
      <ol class="messages__list">
        {messages.map((message) => (
          <Message
            key={message.id}
            message={message}
            assistantName={assistantName}
            texts={texts}
            canRetry={message === last}
            onRetry={onRetry}
          />
        ))}
      </ol>
    </section>
  );
}
