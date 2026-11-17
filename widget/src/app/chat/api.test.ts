import type { ChatStreamEvent } from 'gateway/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GatewayTransport } from './api.js';

const internal = { code: 'internal_error' as const, message: 'Eroare.', retryable: true };

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}

async function collect(transport: GatewayTransport): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  await transport.stream({ message: 'Bună' }, new AbortController().signal, (event) =>
    events.push(event),
  );
  return events;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GatewayTransport', () => {
  it('posts to /api/chat and parses SSE events split across chunks', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          'data: {"type":"delta","te',
          'xt":"Bună ziua"}\n\n: ping\n\n',
          'data: {"type":"end","conversationId":"c","messageId":"m","citations":[]}\n\n',
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);

    const events = await collect(new GatewayTransport('pilot', 'ro', internal));
    expect(events).toEqual([
      { type: 'delta', text: 'Bună ziua' },
      { type: 'end', conversationId: 'c', messageId: 'm', citations: [] },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/chat');
    expect(JSON.parse(init.body as string)).toEqual({
      tenant: 'pilot',
      locale: 'ro',
      message: 'Bună',
    });
  });

  it('turns a JSON error response into an error event', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: 'rate_limited', message: 'Prea multe.', retryable: true } },
            { status: 429 },
          ),
        ),
    );
    expect(await collect(new GatewayTransport('pilot', 'ro', internal))).toEqual([
      { type: 'error', error: { code: 'rate_limited', message: 'Prea multe.', retryable: true } },
    ]);
  });

  it('turns malformed events into an internal error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(['data: {"type":"hack"}\n\n'])));
    expect(await collect(new GatewayTransport('pilot', 'ro', internal))).toEqual([
      { type: 'error', error: internal },
    ]);
  });
});
