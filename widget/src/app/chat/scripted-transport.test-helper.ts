import type { ChatStreamEvent, ConversationList, History, Rating } from 'gateway/protocol';
import { ApiError, type ChatTransport, type StreamRequest } from './api.js';

export type StreamScript = (
  emit: (event: ChatStreamEvent) => void,
  signal: AbortSignal,
) => Promise<void>;

/** Test double for the gateway: scripted streams, in-memory conversations, recorded calls. */
export class ScriptedTransport implements ChatTransport {
  readonly requests: StreamRequest[] = [];
  readonly stopped: string[] = [];
  readonly deleted: string[] = [];
  readonly ratings: [string, Rating | null][] = [];
  readonly closingFeedback: [string, Rating, string | undefined][] = [];
  conversations: ConversationList = { conversations: [], hasMore: false };
  histories = new Map<string, History>();
  followUps: string[] = [];
  readonly suggestedFor: string[] = [];
  /** Makes the next non-stream call fail with this error. */
  failNext: ApiError | undefined;

  constructor(private readonly scripts: StreamScript[] = []) {}

  async stream(request: StreamRequest, signal: AbortSignal, onEvent: (e: ChatStreamEvent) => void) {
    this.requests.push(request);
    const script = this.scripts.shift();
    if (!script) throw new Error('no script');
    await script(onEvent, signal);
  }

  stop(taskId: string): Promise<void> {
    this.stopped.push(taskId);
    return Promise.resolve();
  }

  async listConversations(): Promise<ConversationList> {
    await this.#maybeFail();
    return this.conversations;
  }

  async getHistory(conversationId: string): Promise<History> {
    await this.#maybeFail();
    const history = this.histories.get(conversationId);
    if (!history) {
      throw new ApiError({ code: 'conversation_not_found', message: 'Lipsă.', retryable: false });
    }
    return history;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.#maybeFail();
    this.deleted.push(conversationId);
  }

  async rateMessage(messageId: string, rating: Rating | null): Promise<void> {
    await this.#maybeFail();
    this.ratings.push([messageId, rating]);
  }

  async sendConversationFeedback(conversationId: string, rating: Rating, comment?: string) {
    await this.#maybeFail();
    this.closingFeedback.push([conversationId, rating, comment]);
  }

  async suggested(messageId: string): Promise<string[]> {
    await this.#maybeFail();
    this.suggestedFor.push(messageId);
    return this.followUps;
  }

  async #maybeFail(): Promise<void> {
    await Promise.resolve();
    const error = this.failNext;
    this.failNext = undefined;
    if (error) throw error;
  }
}
