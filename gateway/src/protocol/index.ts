/**
 * Internal chat protocol between gateway and widget (ADR 001).
 * The widget consumes only these shapes, never Dify events directly.
 * Browser-safe: no Node imports. Written with `zod/mini` to keep the widget bundle small (ADR 004).
 */
import * as z from 'zod/mini';

export { SseParser, type SseMessage } from './sse.js';

export const LOCALES = ['ro', 'en'] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof localeSchema>;

/** Who wrote a message. `operator` and `system` are reserved for E10 (human handover). */
export const authorSchema = z.enum(['assistant', 'operator', 'user', 'system']);
export type Author = z.infer<typeof authorSchema>;

export const ERROR_CODES = [
  'invalid_request',
  'tenant_not_found',
  'forbidden_origin',
  'conversation_not_found',
  'rate_limited',
  'upstream_unavailable',
  'upstream_timeout',
  'model_error',
  'configuration_error',
  'internal_error',
] as const;
export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const MAX_MESSAGE_LENGTH = 4000;

export const tenantIdSchema = z.string().check(z.regex(/^[a-z0-9-]{1,64}$/));

/** Body of `POST /api/chat`. Strict: unknown fields are rejected, never forwarded to Dify. */
export const chatRequestSchema = z.strictObject({
  tenant: tenantIdSchema,
  message: z.string().check(z.trim(), z.minLength(1), z.maxLength(MAX_MESSAGE_LENGTH)),
  conversationId: z.optional(z.uuid()),
  locale: z._default(localeSchema, 'ro'),
});
export type ChatRequest = z.input<typeof chatRequestSchema>;

/** Body of `POST /api/chat/stop`. */
export const stopRequestSchema = z.strictObject({
  tenant: tenantIdSchema,
  taskId: z.uuid(),
});
export type StopRequest = z.infer<typeof stopRequestSchema>;

/** One source document under an answer (grouped per document, ADR 005). */
export const citationSchema = z.object({
  position: z.int(),
  documentId: z.optional(z.string()),
  /** Display title: tenant mapping, otherwise the file name without extension. */
  title: z.string(),
  /** Only when the tenant enables `citations.showSnippets`. */
  snippet: z.optional(z.string()),
});
export type Citation = z.infer<typeof citationSchema>;

export const chatErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
});
export type ChatError = z.infer<typeof chatErrorSchema>;

/** Events sent by `POST /api/chat` as SSE `data:` lines, in this order: start, delta*, end | error. */
export const chatStreamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start'),
    conversationId: z.string(),
    messageId: z.string(),
    taskId: z.string(),
    author: authorSchema,
  }),
  z.object({ type: z.literal('delta'), text: z.string() }),
  /** Whole answer replaced (Dify output moderation). */
  z.object({ type: z.literal('replace'), text: z.string() }),
  z.object({
    type: z.literal('end'),
    conversationId: z.string(),
    messageId: z.string(),
    citations: z.array(citationSchema),
  }),
  z.object({ type: z.literal('error'), error: chatErrorSchema }),
]);
export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;

/** JSON body of non-streaming error responses (HTTP 4xx/5xx before the stream starts). */
export const errorResponseSchema = z.object({ error: chatErrorSchema });
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/** `GET /api/widget-config?tenant=&locale=`: public, non-secret data the chat UI needs. */
export const widgetConfigSchema = z.object({
  tenant: tenantIdSchema,
  locale: localeSchema,
  assistantName: z.string(),
  /** Shown automatically when the window opens; empty when neither Dify nor the tenant has one. */
  welcomeMessage: z.string(),
  /** Initial suggested questions (Dify `/parameters`, no model call). */
  suggestedQuestions: z.array(z.string()),
});

export const ratingSchema = z.enum(['like', 'dislike']);
export type Rating = z.infer<typeof ratingSchema>;

/** `GET /api/conversations`: the visitor's conversations, most recent first. */
export const conversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Unix seconds. */
  updatedAt: z.number(),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export const conversationListSchema = z.object({
  conversations: z.array(conversationSummarySchema),
  hasMore: z.boolean(),
});
export type ConversationList = z.infer<typeof conversationListSchema>;

/** One message from the history, already split into the visitor's question and the answer. */
export const historyMessageSchema = z.object({
  id: z.string(),
  author: authorSchema,
  text: z.string(),
  /** Unix seconds. */
  createdAt: z.number(),
  citations: z.array(citationSchema),
  /** The visitor's rating of an answer (assistant messages only). */
  feedback: z.nullable(ratingSchema),
  /** Dify could not produce this answer. */
  failed: z.boolean(),
});
export type HistoryMessage = z.infer<typeof historyMessageSchema>;

/** `GET /api/conversations/:id/messages`: oldest first; `hasMore` means older pages exist. */
export const historySchema = z.object({
  messages: z.array(historyMessageSchema),
  hasMore: z.boolean(),
});
export type History = z.infer<typeof historySchema>;

export const listQuerySchema = z.object({
  tenant: tenantIdSchema,
  /** Pagination cursor: id of the last item of the previous page. */
  after: z.optional(z.uuid()),
});

/** Body of `POST /api/messages/:id/feedback`; `null` removes the rating. */
export const messageFeedbackSchema = z.strictObject({
  tenant: tenantIdSchema,
  rating: z.nullable(ratingSchema),
});

export const MAX_FEEDBACK_COMMENT = 1000;

/** Body of `POST /api/conversations/:id/feedback` (closing feedback, ADR 005). */
export const conversationFeedbackSchema = z.strictObject({
  tenant: tenantIdSchema,
  rating: ratingSchema,
  comment: z.optional(z.string().check(z.trim(), z.maxLength(MAX_FEEDBACK_COMMENT))),
});
export type ConversationFeedback = z.infer<typeof conversationFeedbackSchema>;
export type WidgetConfig = z.infer<typeof widgetConfigSchema>;
