import {
  chatStreamEventSchema,
  errorResponseSchema,
  SseParser,
  widgetConfigSchema,
  type ChatError,
  type ChatStreamEvent,
  type Locale,
  type WidgetConfig,
} from 'gateway/protocol';

export interface StreamRequest {
  message: string;
  conversationId?: string | undefined;
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
