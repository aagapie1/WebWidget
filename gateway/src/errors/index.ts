import type { Tenant } from '../config/tenants.js';
import type { ChatError, ErrorCode, Locale } from '../protocol/index.js';

const RETRYABLE: Readonly<Record<ErrorCode, boolean>> = {
  invalid_request: false,
  tenant_not_found: false,
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
  forbidden_origin: 403,
  conversation_not_found: 404,
  rate_limited: 429,
  upstream_unavailable: 503,
  upstream_timeout: 504,
  model_error: 502,
  configuration_error: 502,
  internal_error: 500,
};

/** Default user-facing texts. Tenants override them with `texts.<locale>["errors.<code>"]`. */
const DEFAULT_TEXTS: Readonly<Record<Locale, Readonly<Record<ErrorCode, string>>>> = {
  ro: {
    invalid_request: 'Mesajul nu a putut fi trimis. Verificați textul și încercați din nou.',
    tenant_not_found: 'Asistentul nu este disponibil pe acest site.',
    forbidden_origin: 'Asistentul nu este disponibil pe acest site.',
    conversation_not_found: 'Conversația nu mai este disponibilă. Începeți o conversație nouă.',
    rate_limited:
      'Ați trimis multe mesaje într-un timp scurt. Încercați din nou peste câteva momente.',
    upstream_unavailable:
      'Asistentul nu este disponibil momentan. Vă rugăm să încercați din nou peste câteva minute.',
    upstream_timeout: 'Răspunsul durează prea mult. Vă rugăm să încercați din nou.',
    model_error: 'Asistentul nu a putut formula un răspuns. Vă rugăm să încercați din nou.',
    configuration_error:
      'Asistentul nu este disponibil momentan din cauza unei probleme tehnice. Am fost notificați.',
    internal_error: 'A apărut o eroare neașteptată. Vă rugăm să încercați din nou.',
  },
  en: {
    invalid_request: 'The message could not be sent. Please check it and try again.',
    tenant_not_found: 'The assistant is not available on this site.',
    forbidden_origin: 'The assistant is not available on this site.',
    conversation_not_found: 'This conversation is no longer available. Please start a new one.',
    rate_limited: 'You sent many messages in a short time. Please try again in a moment.',
    upstream_unavailable:
      'The assistant is currently unavailable. Please try again in a few minutes.',
    upstream_timeout: 'The answer is taking too long. Please try again.',
    model_error: 'The assistant could not produce an answer. Please try again.',
    configuration_error:
      'The assistant is unavailable due to a technical problem. We have been notified.',
    internal_error: 'An unexpected error occurred. Please try again.',
  },
};

export function chatError(code: ErrorCode, locale: Locale, tenant?: Tenant): ChatError {
  const message = tenant?.texts[locale]?.[`errors.${code}`] ?? DEFAULT_TEXTS[locale][code];
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
