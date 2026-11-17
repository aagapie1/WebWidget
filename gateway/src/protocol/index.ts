/**
 * Internal chat protocol between gateway and widget (ADR 001).
 * The widget consumes only these shapes, never Dify events directly.
 * This module must stay free of Node-only imports: the widget imports it.
 */
import { z } from 'zod';

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

/** Body of `POST /api/chat`. Strict: unknown fields are rejected, never forwarded to Dify. */
export const chatRequestSchema = z.strictObject({
  tenant: z.string().regex(/^[a-z0-9-]{1,64}$/),
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  conversationId: z.uuid().optional(),
  locale: localeSchema.default('ro'),
});
export type ChatRequest = z.input<typeof chatRequestSchema>;

export const citationSchema = z.object({
  position: z.number().int(),
  documentId: z.string().optional(),
  documentName: z.string(),
  datasetName: z.string().optional(),
  snippet: z.string().optional(),
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
