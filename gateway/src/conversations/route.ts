import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as z from 'zod/mini';
import type { AppEnv } from '../config/env.js';
import type { Tenant, TenantRegistry } from '../config/tenants.js';
import {
  deleteConversation,
  getMessages,
  listConversations,
  sendMessageFeedback,
} from '../dify/client.js';
import { toConversationList, toHistory } from '../dify/history.js';
import { replyError } from '../errors/index.js';
import type { FeedbackStore } from '../feedback/store.js';
import {
  conversationFeedbackSchema,
  listQuerySchema,
  messageFeedbackSchema,
  tenantIdSchema,
  type ConversationList,
} from '../protocol/index.js';
import { maskPersonalData } from '../privacy/mask.js';
import { readVisitor } from '../visitor/index.js';

const idParams = z.object({ id: z.uuid() });
const tenantQuery = z.object({ tenant: tenantIdSchema });

export interface ConversationRouteOptions {
  env: AppEnv;
  tenants: TenantRegistry;
  feedbackStore: FeedbackStore;
}

/**
 * The visitor's conversations, history, deletion and feedback (ADR 005). Every call is scoped to
 * the visitor from the signed cookie: Dify only returns conversations of that `user`.
 */
export function conversationRoutes(app: FastifyInstance, options: ConversationRouteOptions): void {
  const { env, tenants, feedbackStore } = options;

  const tenantOf = (value: unknown): Tenant | undefined => {
    const parsed = tenantQuery.safeParse(value);
    return parsed.success ? tenants.get(parsed.data.tenant) : undefined;
  };
  const ownOrigin = (request: FastifyRequest): boolean =>
    request.headers.origin === env.PUBLIC_ORIGIN;

  app.get('/api/conversations', async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) return replyError(reply, 'invalid_request', 'ro');
    const tenant = tenants.get(query.data.tenant);
    if (!tenant) return replyError(reply, 'tenant_not_found', 'ro');

    const user = readVisitor(request);
    const empty: ConversationList = { conversations: [], hasMore: false };
    if (!user) return reply.header('cache-control', 'no-store').send(empty);

    const result = await listConversations(tenant, user, query.data.after);
    if (!result.ok) return replyError(reply, result.code, 'ro', tenant);
    return reply.header('cache-control', 'no-store').send(toConversationList(result.value));
  });

  app.get('/api/conversations/:id/messages', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const query = listQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) return replyError(reply, 'invalid_request', 'ro');
    const tenant = tenants.get(query.data.tenant);
    if (!tenant) return replyError(reply, 'tenant_not_found', 'ro');

    const user = readVisitor(request);
    if (!user) return replyError(reply, 'conversation_not_found', 'ro', tenant);

    const result = await getMessages(tenant, user, params.data.id, query.data.after);
    if (!result.ok) return replyError(reply, result.code, 'ro', tenant);
    return reply.header('cache-control', 'no-store').send(toHistory(result.value, tenant));
  });

  app.delete('/api/conversations/:id', async (request, reply) => {
    if (!ownOrigin(request)) return replyError(reply, 'forbidden_origin', 'ro');
    const params = idParams.safeParse(request.params);
    const tenant = tenantOf(request.query);
    if (!params.success) return replyError(reply, 'invalid_request', 'ro');
    if (!tenant) return replyError(reply, 'tenant_not_found', 'ro');

    const user = readVisitor(request);
    if (!user) return replyError(reply, 'conversation_not_found', 'ro', tenant);

    const result = await deleteConversation(tenant, user, params.data.id);
    if (!result.ok) return replyError(reply, result.code, 'ro', tenant);
    await feedbackStore.delete(tenant.id, params.data.id);
    return reply.code(204).send();
  });

  app.post('/api/messages/:id/feedback', async (request, reply) => {
    if (!ownOrigin(request)) return replyError(reply, 'forbidden_origin', 'ro');
    const params = idParams.safeParse(request.params);
    const body = messageFeedbackSchema.safeParse(request.body);
    if (!params.success || !body.success) return replyError(reply, 'invalid_request', 'ro');
    const tenant = tenants.get(body.data.tenant);
    if (!tenant) return replyError(reply, 'tenant_not_found', 'ro');

    const user = readVisitor(request);
    if (!user) return replyError(reply, 'conversation_not_found', 'ro', tenant);

    const result = await sendMessageFeedback(tenant, user, params.data.id, body.data.rating);
    if (!result.ok) return replyError(reply, result.code, 'ro', tenant);
    return reply.code(204).send();
  });

  app.post('/api/conversations/:id/feedback', async (request, reply) => {
    if (!ownOrigin(request)) return replyError(reply, 'forbidden_origin', 'ro');
    const params = idParams.safeParse(request.params);
    const body = conversationFeedbackSchema.safeParse(request.body);
    if (!params.success || !body.success) return replyError(reply, 'invalid_request', 'ro');
    const tenant = tenants.get(body.data.tenant);
    if (!tenant) return replyError(reply, 'tenant_not_found', 'ro');

    // Only the conversation's owner may leave feedback on it.
    const user = readVisitor(request);
    if (!user) return replyError(reply, 'conversation_not_found', 'ro', tenant);
    const owned = await getMessages(tenant, user, params.data.id);
    if (!owned.ok) return replyError(reply, owned.code, 'ro', tenant);

    const comment = body.data.comment ? maskPersonalData(body.data.comment) : undefined;
    await feedbackStore.save(
      tenant.id,
      params.data.id,
      { rating: body.data.rating, ...(comment ? { comment } : {}), createdAt: Date.now() },
      tenant.feedback.retentionDays * 24 * 60 * 60,
    );
    return reply.code(204).send();
  });
}
