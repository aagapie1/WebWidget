import {
  chatStreamEventSchema,
  conversationListSchema,
  errorResponseSchema,
  historySchema,
  SseParser,
  widgetConfigSchema,
  type ChatError,
  type ChatStreamEvent,
  type ConversationList,
  type History,
  type Locale,
  type Rating,
  type WidgetConfig,
} from 'gateway/protocol';

export interface StreamRequest {
  message: string;
  conversationId?: string | undefined;
}

/** A gateway call failed; `error` is already localized for the visitor. */
export class ApiError extends Error {
  constructor(readonly error: ChatError) {
    super(error.code);
  }
}

/** Talks to the gateway (same origin as the iframe). Mockable in tests. */
export interface ChatTransport {
  /** Resolves when the stream ends; rejects on network failure or abort. */
  stream(
    request: StreamRequest,
    signal: AbortSignal,
    onEvent: (event: ChatStreamEvent) => void,
  ): Promise<void>;
  stop(taskId: string): Promise<void>;
  /** The following reject with ApiError. */
  listConversations(after?: string): Promise<ConversationList>;
  getHistory(conversationId: string, before?: string): Promise<History>;
  deleteConversation(conversationId: string): Promise<void>;
  rateMessage(messageId: string, rating: Rating | null): Promise<void>;
  sendConversationFeedback(conversationId: string, rating: Rating, comment?: string): Promise<void>;
}

export class GatewayTransport implements ChatTransport {
  constructor(
    private readonly tenant: string,
    private readonly locale: Locale,
    private readonly internalError: ChatError,
  ) {}

  async stream(
    request: StreamRequest,
    signal: AbortSignal,
    onEvent: (event: ChatStreamEvent) => void,
  ): Promise<void> {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      signal,
      body: JSON.stringify({
        tenant: this.tenant,
        locale: this.locale,
        message: request.message,
        ...(request.conversationId ? { conversationId: request.conversationId } : {}),
      }),
    });

    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !type.startsWith('text/event-stream') || !response.body) {
      onEvent({ type: 'error', error: await this.#errorFrom(response) });
      return;
    }

    const parser = new SseParser();
    const reader = response.body.getReader();
    const handle = (data: string): void => {
      if (data === '') return;
      let json: unknown;
      try {
        json = JSON.parse(data);
      } catch {
        onEvent({ type: 'error', error: this.internalError });
        return;
      }
      const parsed = chatStreamEventSchema.safeParse(json);
      onEvent(parsed.success ? parsed.data : { type: 'error', error: this.internalError });
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const message of parser.push(value)) handle(message.data);
    }
    for (const message of parser.flush()) handle(message.data);
  }

  async stop(taskId: string): Promise<void> {
    await fetch('/api/chat/stop', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ tenant: this.tenant, taskId }),
    });
  }

  async listConversations(after?: string): Promise<ConversationList> {
    const query = new URLSearchParams({ tenant: this.tenant, ...(after ? { after } : {}) });
    return conversationListSchema.parse(await this.#json(`/api/conversations?${query.toString()}`));
  }

  async getHistory(conversationId: string, before?: string): Promise<History> {
    const query = new URLSearchParams({
      tenant: this.tenant,
      ...(before ? { after: before } : {}),
    });
    const path = `/api/conversations/${encodeURIComponent(conversationId)}/messages?${query.toString()}`;
    return historySchema.parse(await this.#json(path));
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const query = new URLSearchParams({ tenant: this.tenant });
    await this.#json(
      `/api/conversations/${encodeURIComponent(conversationId)}?${query.toString()}`,
      {
        method: 'DELETE',
      },
    );
  }

  async rateMessage(messageId: string, rating: Rating | null): Promise<void> {
    await this.#post(`/api/messages/${encodeURIComponent(messageId)}/feedback`, {
      tenant: this.tenant,
      rating,
    });
  }

  async sendConversationFeedback(
    conversationId: string,
    rating: Rating,
    comment?: string,
  ): Promise<void> {
    await this.#post(`/api/conversations/${encodeURIComponent(conversationId)}/feedback`, {
      tenant: this.tenant,
      rating,
      ...(comment ? { comment } : {}),
    });
  }

  #post(path: string, body: object): Promise<unknown> {
    return this.#json(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /** Same-origin request; JSON body (or nothing for 204). Rejects with ApiError. */
  async #json(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(path, { credentials: 'same-origin', ...init });
    } catch {
      throw new ApiError(this.internalError);
    }
    if (!response.ok) throw new ApiError(await this.#errorFrom(response));
    if (response.status === 204) return undefined;
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new ApiError(this.internalError);
    }
  }

  async #errorFrom(response: Response): Promise<ChatError> {
    try {
      const parsed = errorResponseSchema.safeParse(await response.json());
      if (parsed.success) return parsed.data.error;
    } catch {
      // not JSON
    }
    return this.internalError;
  }
}

export async function fetchWidgetConfig(tenant: string, locale: Locale): Promise<WidgetConfig> {
  const url = `/api/widget-config?tenant=${encodeURIComponent(tenant)}&locale=${locale}`;
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`widget-config ${response.status}`);
  return widgetConfigSchema.parse(await response.json());
}
