import type { Rating } from 'gateway/protocol';
import { useEffect, useRef } from 'preact/hooks';
import type { ChatMessage } from '../chat/controller.js';
import type { Texts } from '../i18n/index.js';
import type { Identity } from './Avatar.js';
import { Message } from './Message.js';
import { SuggestedQuestions } from './SuggestedQuestions.js';

export interface MessageListProps {
  messages: readonly ChatMessage[];
  assistantName: string;
  texts: Texts;
  onRetry: () => void;
  onRate?: (id: string, rating: Rating) => void;
  /** Initial suggestions, shown until the first question of the conversation. */
  suggestions?: readonly string[];
  onAsk?: (question: string) => void;
  busy?: boolean;
  hasOlder?: boolean;
  loading?: boolean;
  onLoadOlder?: () => void;
  identity?: Identity;
  /** Follow-up questions under the last answer (opt-in per tenant). */
  followUps?: readonly string[];
}

/**
 * No aria-live here: streamed deltas would be read piece by piece. Completed answers are
 * announced once by <Announcer> (ADR 004).
 */
export function MessageList(props: MessageListProps) {
  const { messages, assistantName, texts, onRetry } = props;
  const scroller = useRef<HTMLElement>(null);
  const stickToBottom = useRef(true);
  const newestId = messages.at(-1)?.id;
  const previousNewest = useRef(newestId);

  useEffect(() => {
    const element = scroller.current;
    // Loading older messages adds above: keep the reader's position instead of jumping down.
    const appendedOrStreaming = newestId !== previousNewest.current || stickToBottom.current;
    previousNewest.current = newestId;
    if (element && appendedOrStreaming && stickToBottom.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages, newestId]);

  const onScroll = () => {
    const element = scroller.current;
    if (!element) return;
    // Follow new text only while the reader is at the bottom.
    stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
  };

  const last = messages.at(-1);
  const hasQuestion = messages.some((message) => message.author === 'user');
  return (
    // Focusable so keyboard users can scroll long conversations (scrollable region).
    <section
      class="messages"
      aria-label={texts.messages.label}
      ref={scroller}
      onScroll={onScroll}
      tabIndex={0}
    >
      {props.hasOlder && props.onLoadOlder && (
        <button
          type="button"
          class="text-button messages__older"
          disabled={props.loading}
          onClick={props.onLoadOlder}
        >
          {texts.messages.loadOlder}
        </button>
      )}
      <ol class="messages__list">
        {messages.map((message) => (
          <Message
            key={message.id}
            message={message}
            assistantName={assistantName}
            texts={texts}
            canRetry={message === last}
            onRetry={onRetry}
            {...(props.onRate ? { onRate: props.onRate } : {})}
            {...(props.identity ? { identity: props.identity } : {})}
          />
        ))}
      </ol>
      {hasQuestion && !props.busy && props.followUps && props.onAsk && (
        <SuggestedQuestions
          questions={props.followUps}
          texts={texts}
          disabled={false}
          onAsk={props.onAsk}
        />
      )}
      {!hasQuestion && props.suggestions && props.onAsk && (
        <SuggestedQuestions
          questions={props.suggestions}
          texts={texts}
          disabled={props.busy ?? false}
          onAsk={props.onAsk}
        />
      )}
    </section>
  );
}
