import type { Tenant } from '../config/tenants.js';
import type { FastifyReply } from 'fastify';
import type { ChatError, ErrorCode, ErrorResponse, Locale } from '../protocol/index.js';
import { ERROR_TEXTS } from '../protocol/texts.js';

const RETRYABLE: Readonly<Record<ErrorCode, boolean>> = {
  invalid_request: false,
  tenant_not_found: false,
  tenant_disabled: false,
  forbidden_origin: false,
  conversation_not_found: false,
  rate_limited: true,
  upstream_unavailable: true,
  upstream_timeout: true,
  model_error: true,
  configuration_error: false,
  internal_error: true,
};

export const HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  invalid_request: 400,
  tenant_not_found: 404,
  tenant_disabled: 503,
  forbidden_origin: 403,
  conversation_not_found: 404,
  rate_limited: 429,
  upstream_unavailable: 503,
  upstream_timeout: 504,
  model_error: 502,
  configuration_error: 502,
  internal_error: 500,
};

export function chatError(code: ErrorCode, locale: Locale, tenant?: Tenant): ChatError {
  const message = tenant?.texts[locale]?.[`errors.${code}`] ?? ERROR_TEXTS[locale][code];
  return { code, message, retryable: RETRYABLE[code] };
}

/**
 * Maps a Dify error (HTTP status + `code` from the JSON body or the SSE `error` event)
 * to an internal code. Dify error codes are documented in its Service API reference.
 */
export function mapDifyError(status: number | undefined, difyCode: string | undefined): ErrorCode {
  switch (difyCode) {
    case 'invalid_param':
      // The gateway built a request Dify rejects: our bug, not the user's.
      return 'internal_error';
    case 'not_found':
    case 'conversation_not_exists':
      return 'conversation_not_found';
    case 'too_many_requests':
    case 'rate_limit_error':
    case 'provider_quota_exceeded':
      return 'rate_limited';
    case 'app_unavailable':
    case 'unauthorized':
    case 'provider_not_initialize':
    case 'model_currently_not_support':
      return 'configuration_error';
    case 'completion_request_error':
    case 'invoke_error':
    case 'internal_server_error':
      return 'model_error';
    default:
      break;
  }
  if (status === undefined) return 'model_error';
  if (status === 401 || status === 403) return 'configuration_error';
  if (status === 404) return 'conversation_not_found';
  if (status === 429) return 'rate_limited';
  if (status === 502 || status === 503 || status === 504) return 'upstream_unavailable';
  if (status >= 500) return 'model_error';
  if (status === 400) return 'model_error';
  return 'internal_error';
}

/** Sends a JSON error (`{ error }`) with the matching HTTP status. */
export function replyError(
  reply: FastifyReply,
  code: ErrorCode,
  locale: Locale,
  tenant?: Tenant,
): FastifyReply {
  const body: ErrorResponse = { error: chatError(code, locale, tenant) };
  return reply.code(HTTP_STATUS[code]).send(body);
}
