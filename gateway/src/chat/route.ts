import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Dispatcher } from 'undici';
import type { AppEnv } from '../config/env.js';
import type { TenantRegistry } from '../config/tenants.js';
import {
  classifyNetworkError,
  renameConversation,
  sendChatMessage,
  stopTask,
} from '../dify/client.js';
import { DifyEventNormalizer, type NormalizeResult } from '../dify/events.js';
import { SseParser } from '../protocol/sse.js';
import { replyError } from '../errors/index.js';
import {
  chatRequestSchema,
  stopRequestSchema,
  type ChatStreamEvent,
  type ErrorCode,
  type Locale,
} from '../protocol/index.js';
import type { Tenant } from '../config/tenants.js';
import { resolveVisitor } from '../visitor/index.js';

export interface ChatRouteOptions {
  env: AppEnv;
  tenants: TenantRegistry;
  difyDispatcher?: Dispatcher;
}

export function chatRoute(app: FastifyInstance, options: ChatRouteOptions): void {
  const { env, tenants } = options;

  app.post('/api/chat', async (request, reply) => {
    // The chat iframe is served by this gateway, so its requests carry the gateway's own origin.
    // Embedding sites are checked when the iframe loads (allowedOrigins, frame-ancestors).
    if (request.headers.origin !== env.PUBLIC_ORIGIN) {
      return replyError(reply, 'forbidden_origin', 'ro');
    }

    const parsed = chatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return replyError(reply, 'invalid_request', 'ro');
    }
    const { tenant: tenantId, message, conversationId, locale } = parsed.data;

    const tenant = tenants.get(tenantId);
    if (!tenant) return replyError(reply, 'tenant_not_found', locale);

    const user = resolveVisitor(request, reply, tenant.visitorCookieDays);
    const log = request.log.child({ tenant: tenant.id, conversationId });

    // Aborted when the browser disconnects or the whole answer takes too long.
    const clientGone = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) clientGone.abort();
    });
    const totalTimeout = AbortSignal.timeout(env.DIFY_TOTAL_TIMEOUT_MS);
    const signal = AbortSignal.any([clientGone.signal, totalTimeout]);

    const startedAt = performance.now();
    let result;
    try {
      result = await sendChatMessage({
        tenant,
        query: message,
        user,
        conversationId,
        signal,
        timeouts: { connectMs: env.DIFY_CONNECT_TIMEOUT_MS, idleMs: env.DIFY_IDLE_TIMEOUT_MS },
        ...(options.difyDispatcher ? { dispatcher: options.difyDispatcher } : {}),
      });
    } catch {
      if (clientGone.signal.aborted) {
        log.info('client disconnected before Dify answered');
        return reply;
      }
      return replyError(reply, 'upstream_timeout', locale, tenant);
    }

    if (!result.ok) {
      log.warn(
        { difyStatus: result.status, difyCode: result.difyCode, code: result.code },
        'Dify request failed',
      );
      return replyError(reply, result.code, locale, tenant);
    }

    // From here on the response is a raw SSE stream.
    // Headers already set on the reply (Set-Cookie, X-Request-Id) are copied to the raw response.
    reply.hijack();
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) reply.raw.setHeader(name, value);
    }
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    });

    const stats = await pipeStream(result.body, reply, tenant, locale, signal, totalTimeout);

    // New conversation: set its title from the question, without a model call (SPEC §4).
    if (!conversationId && stats.conversationId) {
      void renameConversation(tenant, user, stats.conversationId, conversationTitle(message)).then(
        (renamed) => {
          if (!renamed.ok) log.warn({ code: renamed.code }, 'conversation rename failed');
        },
      );
    }

    if (clientGone.signal.aborted) {
      // Dify keeps generating and stores the answer: it appears in the history when the visitor
      // comes back (ADR 005). Only the explicit stop button stops the task.
      log.info(
        { ...stats, durationMs: Math.round(performance.now() - startedAt) },
        'client disconnected during stream',
      );
      return reply;
    }
    log.info({ ...stats, durationMs: Math.round(performance.now() - startedAt) }, 'chat answered');
    reply.raw.end();
    return reply;
  });

  app.post('/api/chat/stop', async (request, reply) => {
    if (request.headers.origin !== env.PUBLIC_ORIGIN) {
      return replyError(reply, 'forbidden_origin', 'ro');
    }
    const parsed = stopRequestSchema.safeParse(request.body);
    if (!parsed.success) return replyError(reply, 'invalid_request', 'ro');

    const tenant = tenants.get(parsed.data.tenant);
    if (!tenant) return replyError(reply, 'tenant_not_found', 'ro');

    // Dify only stops tasks of the same `user`, so a visitor cannot stop someone else's answer.
    const user = resolveVisitor(request, reply, tenant.visitorCookieDays);
    const result = await stopTask(tenant, parsed.data.taskId, user);
    if (!result.ok) {
      request.log.warn(
        { tenant: tenant.id, code: result.code, difyStatus: result.status },
        'Dify stop failed',
      );
      return replyError(reply, result.code, 'ro', tenant);
    }
    return reply.code(204).send();
  });
}

interface StreamStats {
  deltas: number;
  outcome: 'end' | ErrorCode | 'aborted';
  taskId?: string;
  conversationId?: string;
}

const TITLE_LENGTH = 50;

/** First ~50 characters of the question, cut at a word boundary. */
export function conversationTitle(question: string): string {
  const clean = question.replace(/\s+/g, ' ').trim();
  if (clean.length <= TITLE_LENGTH) return clean;
  const cut = clean.slice(0, TITLE_LENGTH);
  const space = cut.lastIndexOf(' ');
  return `${(space > 30 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

async function pipeStream(
  body: AsyncIterable<Uint8Array> & { destroy(): void },
  reply: FastifyReply,
  tenant: Tenant,
  locale: Locale,
  signal: AbortSignal,
  totalTimeout: AbortSignal,
): Promise<StreamStats> {
  const parser = new SseParser();
  const normalizer = new DifyEventNormalizer(tenant, locale);
  const stats: StreamStats = { deltas: 0, outcome: 'aborted' };

  const emit = (result: NormalizeResult): boolean => {
    for (const event of result.events) writeEvent(reply, event, stats);
    if (result.ignored === 'ping') reply.raw.write(': ping\n\n');
    return result.done;
  };

  try {
    for await (const chunk of body) {
      for (const message of parser.push(chunk)) {
        if (emit(normalizer.handle(message))) {
          body.destroy();
          return stats;
        }
      }
    }
    for (const message of parser.flush()) {
      if (emit(normalizer.handle(message))) return stats;
    }
    emit(normalizer.finish());
  } catch (error) {
    if (signal.aborted && !totalTimeout.aborted) return stats; // client gone: nothing to send
    emit(normalizer.fail(totalTimeout.aborted ? 'upstream_timeout' : classifyNetworkError(error)));
  }
  return stats;
}

function writeEvent(reply: FastifyReply, event: ChatStreamEvent, stats: StreamStats): void {
  if (event.type === 'start') {
    stats.taskId = event.taskId;
    stats.conversationId = event.conversationId;
  }
  if (event.type === 'delta') stats.deltas++;
  if (event.type === 'end') stats.outcome = 'end';
  if (event.type === 'error') stats.outcome = event.error.code;
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}
