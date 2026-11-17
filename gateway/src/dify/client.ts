import { errors as undiciErrors, request, type Dispatcher } from 'undici';
import type { Tenant } from '../config/tenants.js';
import { mapDifyError } from '../errors/index.js';
import type { ErrorCode } from '../protocol/index.js';
import { difyErrorBodySchema } from './schemas.js';

export interface DifyTimeouts {
  /** Until Dify sends response headers. */
  connectMs: number;
  /** Maximum silence between two body chunks. */
  idleMs: number;
}

export interface ChatMessageParams {
  tenant: Tenant;
  query: string;
  user: string;
  conversationId?: string | undefined;
  signal: AbortSignal;
  timeouts: DifyTimeouts;
  dispatcher?: Dispatcher;
}

export type ChatMessageResult =
  | { ok: true; body: AsyncIterable<Uint8Array> & { destroy(): void } }
  | { ok: false; code: ErrorCode; status?: number; difyCode?: string };

/**
 * `POST {difyBaseUrl}/chat-messages` in streaming mode.
 * `auto_generate_name` is always false (SPEC §4): no extra model call for the title.
 */
export async function sendChatMessage(params: ChatMessageParams): Promise<ChatMessageResult> {
  const body = {
    inputs: {},
    query: params.query,
    response_mode: 'streaming',
    user: params.user,
    auto_generate_name: false,
    ...(params.conversationId ? { conversation_id: params.conversationId } : {}),
  };

  let response: Dispatcher.ResponseData;
  try {
    response = await request(`${params.tenant.difyBaseUrl}/chat-messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${params.tenant.difyApiKey}`,
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: params.signal,
      headersTimeout: params.timeouts.connectMs,
      bodyTimeout: params.timeouts.idleMs,
      ...(params.dispatcher ? { dispatcher: params.dispatcher } : {}),
    });
  } catch (error) {
    if (params.signal.aborted) throw error;
    return { ok: false, code: classifyNetworkError(error) };
  }

  if (response.statusCode >= 200 && response.statusCode < 300) {
    return { ok: true, body: response.body };
  }

  // Error body is small JSON; never forwarded to the client.
  const text = await response.body.text().catch(() => '');
  const parsed = difyErrorBodySchema.safeParse(safeJson(text));
  const difyCode = parsed.success ? parsed.data.code : undefined;
  return {
    ok: false,
    code: mapDifyError(response.statusCode, difyCode),
    status: response.statusCode,
    ...(difyCode ? { difyCode } : {}),
  };
}

/** Maps network-level failures (no HTTP response, or stream interrupted) to internal codes. */
export function classifyNetworkError(error: unknown): ErrorCode {
  if (
    error instanceof undiciErrors.HeadersTimeoutError ||
    error instanceof undiciErrors.BodyTimeoutError ||
    error instanceof undiciErrors.ConnectTimeoutError
  ) {
    return 'upstream_timeout';
  }
  return 'upstream_unavailable';
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
