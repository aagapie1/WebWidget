import type {
  Author,
  ChatError,
  ChatStreamEvent,
  Citation,
  ConversationSummary,
  HistoryMessage,
  Rating,
} from 'gateway/protocol';
import type { Texts } from '../i18n/index.js';
import { ApiError, type ChatTransport } from './api.js';

export type MessageStatus = 'waiting' | 'streaming' | 'complete' | 'stopped' | 'error';

export interface ChatMessage {
  id: string;
  /** `operator` and `system` are reserved for E10 (human handover); `system` is also used for notices. */
  author: Author;
  text: string;
  status: MessageStatus;
  error?: ChatError;
  /** Dify message id of an answer: needed to rate it. */
  serverId?: string;
  citations?: readonly Citation[];
  feedback?: Rating | null;
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
  /** Current conversation on the server (undefined until the first answer starts). */
  conversationId: string | undefined;
  /** Older messages of the current conversation can be loaded. */
  hasOlder: boolean;
  /** Initial suggested questions, shown while the conversation has no question yet. */
  suggestions: readonly string[];
  conversations: readonly ConversationSummary[];
  conversationsHasMore: boolean;
  /** A history, list or delete request is running. */
  loading: boolean;
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
  #state: ChatState = {
    messages: [],
    busy: false,
    announcement: { id: 0, text: '' },
    conversationId: undefined,
    hasOlder: false,
    suggestions: [],
    conversations: [],
    conversationsHasMore: false,
    loading: false,
  };
  readonly #listeners = new Set<(state: ChatState) => void>();
  readonly #transport: ChatTransport;
  readonly #texts: Texts;
  readonly #schedule: (flush: () => void) => void;
  readonly #toPlainText: (markdown: string) => string;

  #welcome = '';
  #taskId: string | undefined;
  #abort: AbortController | undefined;
  #stopRequested = false;
  #pending = '';
  #flushScheduled = false;
  #lastQuestion = '';
  /** Incremented when the visible conversation changes; stale async results are ignored. */
  #generation = 0;

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
    return this.#state.conversationId;
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

  setSuggestions(questions: readonly string[]): void {
    this.#update({ suggestions: questions });
  }

  /** On open: resume the visitor's most recent conversation, if any (ADR 005). */
  async resumeLatest(): Promise<void> {
    try {
      const list = await this.#transport.listConversations();
      this.#update({ conversations: list.conversations, conversationsHasMore: list.hasMore });
      const latest = list.conversations[0];
      if (latest && !this.#state.conversationId && !this.#hasQuestion()) {
        await this.openConversation(latest.id, { announce: false });
      }
    } catch {
      // No history (or the gateway is unreachable): start with the welcome message.
    }
  }

  async refreshConversations(): Promise<void> {
    this.#update({ loading: true });
    try {
      const list = await this.#transport.listConversations();
      this.#update({ conversations: list.conversations, conversationsHasMore: list.hasMore });
    } catch (error) {
      this.#update({ announcement: this.#announce(this.#errorText(error)) });
    } finally {
      this.#update({ loading: false });
    }
  }

  async loadMoreConversations(): Promise<void> {
    const last = this.#state.conversations.at(-1);
    if (!last || !this.#state.conversationsHasMore) return;
    this.#update({ loading: true });
    try {
      const list = await this.#transport.listConversations(last.id);
      this.#update({
        conversations: [...this.#state.conversations, ...list.conversations],
        conversationsHasMore: list.hasMore,
      });
    } catch (error) {
      this.#update({ announcement: this.#announce(this.#errorText(error)) });
    } finally {
      this.#update({ loading: false });
    }
  }

  /** Shows an earlier conversation with its history (answers finished while away included). */
  async openConversation(id: string, options: { announce?: boolean } = {}): Promise<boolean> {
    this.stop();
    const generation = ++this.#generation;
    this.#update({ loading: true });
    try {
      const history = await this.#transport.getHistory(id);
      if (generation !== this.#generation) return false;
      this.#lastQuestion = '';
      const title = this.#state.conversations.find((item) => item.id === id)?.title;
      this.#update({
        conversationId: id,
        busy: false,
        hasOlder: history.hasMore,
        messages: [
          ...(this.#welcome ? [this.#welcomeMessage()] : []),
          ...history.messages.map((message) => this.#fromHistory(message)),
        ],
        ...(options.announce !== false
          ? { announcement: this.#announce(this.#texts.conversations.opened(title ?? '')) }
          : {}),
      });
      return true;
    } catch (error) {
      if (options.announce !== false) {
        this.#update({ announcement: this.#announce(this.#errorText(error)) });
      }
      return false;
    } finally {
      this.#update({ loading: false });
    }
  }

  /** Loads the previous page of the current conversation, above the visible messages. */
  async loadOlder(): Promise<void> {
    const conversationId = this.#state.conversationId;
    const oldest = this.#state.messages.find((message) => message.serverId);
    if (!conversationId || !oldest?.serverId || !this.#state.hasOlder) return;
    const generation = this.#generation;
    this.#update({ loading: true });
    try {
      const history = await this.#transport.getHistory(conversationId, oldest.serverId);
      if (generation !== this.#generation) return;
      const [welcome, ...rest] = this.#state.messages;
      const hasWelcome = welcome?.id.startsWith('welcome');
      const older = history.messages.map((message) => this.#fromHistory(message));
      this.#update({
        hasOlder: history.hasMore,
        messages:
          hasWelcome && welcome
            ? [welcome, ...older, ...rest]
            : [...older, ...this.#state.messages],
      });
    } catch (error) {
      this.#update({ announcement: this.#announce(this.#errorText(error)) });
    } finally {
      this.#update({ loading: false });
    }
  }

  /** Deletes a conversation; if it is the visible one, a new conversation starts. */
  async deleteConversation(id: string): Promise<boolean> {
    this.#update({ loading: true });
    try {
      await this.#transport.deleteConversation(id);
      this.#update({
        conversations: this.#state.conversations.filter((item) => item.id !== id),
        announcement: this.#announce(this.#texts.conversations.deleted),
      });
      if (this.#state.conversationId === id) this.#reset();
      return true;
    } catch (error) {
      this.#update({ announcement: this.#announce(this.#errorText(error)) });
      return false;
    } finally {
      this.#update({ loading: false });
    }
  }

  /** 👍/👎 on an answer; clicking the active rating again removes it. Optimistic. */
  async rate(messageId: string, rating: Rating): Promise<void> {
    const message = this.#state.messages.find((item) => item.id === messageId);
    if (!message?.serverId) return;
    const previous = message.feedback ?? null;
    const next = previous === rating ? null : rating;
    this.#patch(messageId, { feedback: next });
    try {
      await this.#transport.rateMessage(message.serverId, next);
      this.#update({
        announcement: this.#announce(
          next ? this.#texts.feedback.thanks : this.#texts.feedback.removed,
        ),
      });
    } catch (error) {
      this.#patch(messageId, { feedback: previous });
      this.#update({ announcement: this.#announce(this.#errorText(error)) });
    }
  }

  /**
   * "Închide conversația": optional feedback, then a new conversation. The closed conversation
   * stays in the list (ADR 005).
   */
  async closeConversation(feedback?: { rating: Rating; comment?: string }): Promise<void> {
    const conversationId = this.#state.conversationId;
    let sent = false;
    if (conversationId && feedback) {
      try {
        await this.#transport.sendConversationFeedback(
          conversationId,
          feedback.rating,
          feedback.comment?.trim() || undefined,
        );
        sent = true;
      } catch {
        // The conversation still closes; the visitor is told the feedback was not saved.
      }
    }
    this.newConversation();
    const text = !feedback
      ? this.#texts.messages.newConversationStarted
      : sent
        ? this.#texts.feedback.closingThanks
        : this.#texts.feedback.notSaved;
    this.#update({ announcement: this.#announce(text) });
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
      // Only an explicit stop ends the task in Dify (ADR 005).
      this.#transport.stop(this.#taskId).catch(() => undefined);
    }
  }

  newConversation(): void {
    this.stop();
    this.#reset();
    this.#update({ announcement: this.#announce(this.#texts.messages.newConversationStarted) });
  }

  #reset(): void {
    this.#generation++;
    this.#lastQuestion = '';
    this.#update({
      conversationId: undefined,
      hasOlder: false,
      messages: this.#welcome ? [this.#welcomeMessage()] : [],
      busy: false,
    });
  }

  #hasQuestion(): boolean {
    return this.#state.messages.some((message) => message.author === 'user');
  }

  #fromHistory(message: HistoryMessage): ChatMessage {
    return {
      id: message.id,
      author: message.author,
      text: message.text,
      status: message.failed ? 'error' : 'complete',
      ...(message.failed
        ? {
            error: {
              code: 'model_error',
              message: this.#texts.errors.answerFailed,
              retryable: false,
            },
          }
        : {}),
      ...(message.author === 'assistant'
        ? { serverId: message.id, citations: message.citations, feedback: message.feedback }
        : {}),
    };
  }

  #errorText(error: unknown): string {
    return error instanceof ApiError ? error.error.message : this.#texts.errors.network;
  }

  async #ask(question: string, allowNewConversation: boolean): Promise<void> {
    const answerId = newId();
    const generation = this.#generation;
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
      if (generation !== this.#generation) return;
      switch (event.type) {
        case 'start':
          this.#taskId = event.taskId;
          this.#update({ conversationId: event.conversationId });
          this.#patch(answerId, {
            status: 'streaming',
            author: event.author,
            serverId: event.messageId,
          });
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
          this.#update({ conversationId: event.conversationId });
          this.#flush(answerId);
          this.#patch(answerId, { citations: event.citations, serverId: event.messageId });
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
        { message: question, conversationId: this.#state.conversationId },
        this.#abort.signal,
        onEvent,
      );
      if (!outcome.finished) this.#finishInterrupted(answerId);
    } catch {
      if (!outcome.finished) this.#finishInterrupted(answerId);
    }

    if (outcome.retryInNewConversation && generation === this.#generation) {
      // The conversation is gone on the server (deleted elsewhere): continue in a new one, once.
      this.#update({
        conversationId: undefined,
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
    // Answer removed meanwhile (other conversation opened while streaming): nothing to finish.
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
    return {
      id: `welcome-${newId()}`,
      author: 'assistant',
      text: this.#welcome,
      status: 'complete',
    };
  }

  #announce(text: string): Announcement {
    return { id: this.#state.announcement.id + 1, text };
  }

  #update(patch: Partial<ChatState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener(this.#state);
  }
}
