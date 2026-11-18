import { errors as undiciErrors, request, type Dispatcher } from 'undici';
import type { Tenant } from '../config/tenants.js';
import { mapDifyError } from '../errors/index.js';
import type { ErrorCode } from '../protocol/index.js';
import {
  difyConversationListSchema,
  difyErrorBodySchema,
  difyMessageListSchema,
  difyParametersSchema,
  difySuggestedSchema,
  type DifyConversationList,
  type DifyMessageList,
  type DifyParameters,
} from './schemas.js';

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

/** Small JSON calls (stop, parameters): bounded by one timeout, never streamed. */
const SHORT_CALL_TIMEOUT_MS = 10_000;

export type SimpleResult<T> =
  { ok: true; value: T } | { ok: false; code: ErrorCode; status?: number; difyCode?: string };

async function callJson(
  tenant: Tenant,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: object,
): Promise<SimpleResult<unknown>> {
  let response: Dispatcher.ResponseData;
  try {
    response = await request(`${tenant.difyBaseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${tenant.difyApiKey}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(SHORT_CALL_TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, code: classifyNetworkError(error) };
  }
  const json = safeJson(await response.body.text().catch(() => ''));
  if (response.statusCode >= 200 && response.statusCode < 300) return { ok: true, value: json };
  const parsed = difyErrorBodySchema.safeParse(json);
  const difyCode = parsed.success ? parsed.data.code : undefined;
  return {
    ok: false,
    code: mapDifyError(response.statusCode, difyCode),
    status: response.statusCode,
    ...(difyCode ? { difyCode } : {}),
  };
}

/** `POST /chat-messages/{task_id}/stop`. Only the user who started the task can stop it. */
export async function stopTask(
  tenant: Tenant,
  taskId: string,
  user: string,
): Promise<SimpleResult<null>> {
  const result = await callJson(
    tenant,
    'POST',
    `/chat-messages/${encodeURIComponent(taskId)}/stop`,
    {
      user,
    },
  );
  return result.ok ? { ok: true, value: null } : result;
}

/** `GET /parameters`: app features; only `opening_statement` is used (E2). */
export async function getParameters(tenant: Tenant): Promise<SimpleResult<DifyParameters>> {
  const result = await callJson(tenant, 'GET', '/parameters');
  if (!result.ok) return result;
  const parsed = difyParametersSchema.safeParse(result.value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, code: 'internal_error' };
}

const pageQuery = (params: Record<string, string | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return search.toString();
};

/** `GET /conversations` — the user's conversations, most recent first. */
export async function listConversations(
  tenant: Tenant,
  user: string,
  lastId?: string,
): Promise<SimpleResult<DifyConversationList>> {
  const query = pageQuery({ user, last_id: lastId, limit: '20', sort_by: '-updated_at' });
  const result = await callJson(tenant, 'GET', `/conversations?${query}`);
  if (!result.ok) return result;
  const parsed = difyConversationListSchema.safeParse(result.value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, code: 'internal_error' };
}

/** `GET /messages` — one page of a conversation, oldest first; `firstId` pages backwards. */
export async function getMessages(
  tenant: Tenant,
  user: string,
  conversationId: string,
  firstId?: string,
): Promise<SimpleResult<DifyMessageList>> {
  const query = pageQuery({
    user,
    conversation_id: conversationId,
    first_id: firstId,
    limit: '20',
  });
  const result = await callJson(tenant, 'GET', `/messages?${query}`);
  if (!result.ok) return result;
  const parsed = difyMessageListSchema.safeParse(result.value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, code: 'internal_error' };
}

export async function deleteConversation(
  tenant: Tenant,
  user: string,
  conversationId: string,
): Promise<SimpleResult<null>> {
  const result = await callJson(
    tenant,
    'DELETE',
    `/conversations/${encodeURIComponent(conversationId)}`,
    {
      user,
    },
  );
  return result.ok ? { ok: true, value: null } : result;
}

/** Sets a title without a model call (`auto_generate: false`, SPEC §4). */
export async function renameConversation(
  tenant: Tenant,
  user: string,
  conversationId: string,
  name: string,
): Promise<SimpleResult<null>> {
  const result = await callJson(
    tenant,
    'POST',
    `/conversations/${encodeURIComponent(conversationId)}/name`,
    { name, auto_generate: false, user },
  );
  return result.ok ? { ok: true, value: null } : result;
}

/** `POST /messages/{id}/feedbacks`; `rating: null` removes the visitor's rating. */
export async function sendMessageFeedback(
  tenant: Tenant,
  user: string,
  messageId: string,
  rating: 'like' | 'dislike' | null,
): Promise<SimpleResult<null>> {
  const result = await callJson(
    tenant,
    'POST',
    `/messages/${encodeURIComponent(messageId)}/feedbacks`,
    {
      rating,
      user,
    },
  );
  return result.ok ? { ok: true, value: null } : result;
}

/** `GET /messages/{id}/suggested`: Dify generates them with a model call (opt-in, ADR 007). */
export async function getSuggestedQuestions(
  tenant: Tenant,
  user: string,
  messageId: string,
): Promise<SimpleResult<string[]>> {
  const query = pageQuery({ user });
  const result = await callJson(
    tenant,
    'GET',
    `/messages/${encodeURIComponent(messageId)}/suggested?${query}`,
  );
  if (!result.ok) return result;
  const parsed = difySuggestedSchema.safeParse(result.value);
  return parsed.success
    ? {
        ok: true,
        value: parsed.data.data
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 3),
      }
    : { ok: false, code: 'internal_error' };
}
