import type { Author, ChatError, ChatStreamEvent } from 'gateway/protocol';
import type { Texts } from '../i18n/index.js';
import type { ChatTransport } from './api.js';

export type MessageStatus = 'waiting' | 'streaming' | 'complete' | 'stopped' | 'error';

export interface ChatMessage {
  id: string;
  /** `operator` and `system` are reserved for E10 (human handover); `system` is also used for notices. */
  author: Author;
  text: string;
  status: MessageStatus;
  error?: ChatError;
}

export interface Announcement {
  id: number;
  text: string;
}

export interface ChatState {
  messages: readonly ChatMessage[];
  busy: boolean;
  /** Text for the visually hidden aria-live region, set once per completed answer (ADR 004). */
  announcement: Announcement;
}

export interface ControllerOptions {
  transport: ChatTransport;
  texts: Texts;
  /** Batches deltas into at most one update per frame. Tests pass a synchronous scheduler. */
  schedule?: (flush: () => void) => void;
  /** Plain text of an answer for the announcement (Markdown → text). */
  toPlainText?: (markdown: string) => string;
}

let nextId = 0;
const newId = (): string => `m${String(++nextId)}`;

/** Framework-free chat state machine; the Preact UI subscribes to it. */
export class ChatController {
  #state: ChatState = { messages: [], busy: false, announcement: { id: 0, text: '' } };
  readonly #listeners = new Set<(state: ChatState) => void>();
  readonly #transport: ChatTransport;
  readonly #texts: Texts;
  readonly #schedule: (flush: () => void) => void;
  readonly #toPlainText: (markdown: string) => string;

  #welcome = '';
  #conversationId: string | undefined;
  #taskId: string | undefined;
  #abort: AbortController | undefined;
  #stopRequested = false;
  #pending = '';
  #flushScheduled = false;
  #lastQuestion = '';

  constructor(options: ControllerOptions) {
    this.#transport = options.transport;
    this.#texts = options.texts;
    this.#schedule = options.schedule ?? ((flush) => requestAnimationFrame(flush));
    this.#toPlainText = options.toPlainText ?? ((text) => text);
  }

  get state(): ChatState {
    return this.#state;
  }

  get conversationId(): string | undefined {
    return this.#conversationId;
  }

  subscribe(listener: (state: ChatState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Shows the welcome message when the conversation is empty. */
  setWelcome(text: string): void {
    this.#welcome = text.trim();
    if (this.#state.messages.length === 0 && this.#welcome) {
      this.#update({ messages: [this.#welcomeMessage()] });
    }
  }

  async send(text: string): Promise<void> {
    const question = text.trim();
    if (!question || this.#state.busy) return;
    this.#lastQuestion = question;
    this.#update({
      messages: [
        ...this.#state.messages,
        { id: newId(), author: 'user', text: question, status: 'complete' },
      ],
    });
    await this.#ask(question, true);
  }

  /** Re-asks the last question after a retryable error, without duplicating it. */
  async retry(): Promise<void> {
    const last = this.#state.messages.at(-1);
    if (this.#state.busy || last?.status !== 'error' || !this.#lastQuestion) return;
    this.#update({ messages: this.#state.messages.slice(0, -1) });
    await this.#ask(this.#lastQuestion, true);
  }

  stop(): void {
    if (!this.#state.busy || !this.#abort) return;
    this.#stopRequested = true;
    this.#abort.abort();
    if (this.#taskId) {
      // Best effort: the gateway also stops Dify when the connection closes.
      this.#transport.stop(this.#taskId).catch(() => undefined);
    }
  }

  newConversation(): void {
    this.stop();
    this.#conversationId = undefined;
    this.#lastQuestion = '';
    this.#update({
      messages: this.#welcome ? [this.#welcomeMessage()] : [],
      busy: false,
      announcement: this.#announce(this.#texts.messages.newConversationStarted),
    });
  }

  async #ask(question: string, allowNewConversation: boolean): Promise<void> {
    const answerId = newId();
    this.#taskId = undefined;
    this.#stopRequested = false;
    this.#pending = '';
    this.#abort = new AbortController();
    this.#update({
      busy: true,
      messages: [
        ...this.#state.messages,
        { id: answerId, author: 'assistant', text: '', status: 'waiting' },
      ],
    });

    // Mutated from the event callback; an object so TypeScript does not narrow it to `false`.
    const outcome = { finished: false, retryInNewConversation: false };
    const onEvent = (event: ChatStreamEvent): void => {
      switch (event.type) {
        case 'start':
          this.#conversationId = event.conversationId;
          this.#taskId = event.taskId;
          this.#patch(answerId, { status: 'streaming', author: event.author });
          break;
        case 'delta':
          this.#pending += event.text;
          this.#scheduleFlush(answerId);
          break;
        case 'replace':
          this.#pending = '';
          this.#patch(answerId, { text: event.text, status: 'streaming' });
          break;
        case 'end':
          outcome.finished = true;
          this.#conversationId = event.conversationId;
          this.#flush(answerId);
          this.#finish(answerId, 'complete');
          break;
        case 'error':
          outcome.finished = true;
          this.#flush(answerId);
          if (event.error.code === 'conversation_not_found' && allowNewConversation) {
            outcome.retryInNewConversation = true;
          } else {
            this.#finish(answerId, 'error', event.error);
          }
          break;
      }
    };

    try {
      await this.#transport.stream(
        { message: question, conversationId: this.#conversationId },
        this.#abort.signal,
        onEvent,
      );
      if (!outcome.finished) this.#finishInterrupted(answerId);
    } catch {
      if (!outcome.finished) this.#finishInterrupted(answerId);
    }

    if (outcome.retryInNewConversation) {
      // The conversation expired on the server: continue in a new one, once.
      this.#conversationId = undefined;
      this.#update({
        messages: [
          ...this.#state.messages.filter((message) => message.id !== answerId),
          {
            id: newId(),
            author: 'system',
            text: this.#texts.messages.newConversationStarted,
            status: 'complete',
          },
        ],
      });
      await this.#ask(question, false);
    }
  }

  #finishInterrupted(answerId: string): void {
    this.#flush(answerId);
    if (this.#stopRequested) {
      this.#finish(answerId, 'stopped');
    } else {
      this.#finish(answerId, 'error', {
        code: 'upstream_unavailable',
        message: this.#texts.errors.network,
        retryable: true,
      });
    }
  }

  #finish(answerId: string, status: 'complete' | 'stopped' | 'error', error?: ChatError): void {
    const message = this.#state.messages.find((item) => item.id === answerId);
    // Answer removed meanwhile ("Conversație nouă" while streaming): nothing to finish.
    if (!message) return;
    const text = this.#toPlainText(message.text);
    let announcement: string;
    if (status === 'error' && error) announcement = [text, error.message].filter(Boolean).join(' ');
    else if (status === 'stopped')
      announcement = [text, this.#texts.messages.stopped].filter(Boolean).join(' ');
    else announcement = text;

    this.#update({
      busy: false,
      messages: this.#state.messages.map((item) =>
        item.id === answerId ? { ...item, status, ...(error ? { error } : {}) } : item,
      ),
      announcement: this.#announce(announcement),
    });
    this.#abort = undefined;
  }

  #scheduleFlush(answerId: string): void {
    if (this.#flushScheduled) return;
    this.#flushScheduled = true;
    this.#schedule(() => {
      this.#flush(answerId);
    });
  }

  #flush(answerId: string): void {
    this.#flushScheduled = false;
    if (!this.#pending) return;
    const pending = this.#pending;
    this.#pending = '';
    const message = this.#state.messages.find((item) => item.id === answerId);
    if (!message) return;
    this.#patch(answerId, { text: message.text + pending, status: 'streaming' });
  }

  #patch(id: string, patch: Partial<ChatMessage>): void {
    this.#update({
      messages: this.#state.messages.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
  }

  #welcomeMessage(): ChatMessage {
    return { id: newId(), author: 'assistant', text: this.#welcome, status: 'complete' };
  }

  #announce(text: string): Announcement {
    return { id: this.#state.announcement.id + 1, text };
  }

  #update(patch: Partial<ChatState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener(this.#state);
  }
}
