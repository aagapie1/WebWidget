import type { ErrorCode, Locale } from './index.js';

/**
 * UI text keys a tenant may override (`texts.ro` / `texts.en`, ADR 007). Unknown keys are a
 * validation error. The widget test checks that this list matches its dictionaries exactly.
 */
export const WIDGET_TEXT_KEYS = [
  'launcher.open',
  'launcher.close',
  'frameTitle',
  'proactive.close',
  'header.minimize',
  'header.newConversation',
  'header.closeConversation',
  'header.conversations',
  'header.subtitle',
  'messages.label',
  'messages.you',
  'messages.typing',
  'messages.stopped',
  'messages.newConversationStarted',
  'messages.loadOlder',
  'composer.label',
  'composer.placeholder',
  'composer.hint',
  'composer.send',
  'composer.stop',
  'suggestions.label',
  'citations.label',
  'feedback.group',
  'feedback.like',
  'feedback.dislike',
  'feedback.thanks',
  'feedback.removed',
  'feedback.closingTitle',
  'feedback.closingIntro',
  'feedback.closingLike',
  'feedback.closingDislike',
  'feedback.commentLabel',
  'feedback.commentHint',
  'feedback.send',
  'feedback.skip',
  'feedback.back',
  'feedback.closingThanks',
  'feedback.notSaved',
  'conversations.title',
  'conversations.back',
  'conversations.empty',
  'conversations.untitled',
  'conversations.current',
  'conversations.confirmDelete',
  'conversations.confirm',
  'conversations.cancel',
  'conversations.deleted',
  'conversations.more',
  'errors.retry',
  'errors.loadFailed',
  'errors.network',
  'errors.answerFailed',
  'links.newTab',
] as const;

/** Texts used by the gateway itself: the welcome message and localized error messages. */
export const GATEWAY_TEXT_KEYS = [
  'welcome',
  'errors.invalid_request',
  'errors.tenant_not_found',
  'errors.tenant_disabled',
  'errors.forbidden_origin',
  'errors.conversation_not_found',
  'errors.rate_limited',
  'errors.upstream_unavailable',
  'errors.upstream_timeout',
  'errors.model_error',
  'errors.configuration_error',
  'errors.internal_error',
] as const;

export type WidgetTextKey = (typeof WIDGET_TEXT_KEYS)[number];
export type TextKey = WidgetTextKey | (typeof GATEWAY_TEXT_KEYS)[number];
export const TEXT_KEYS: readonly TextKey[] = [...WIDGET_TEXT_KEYS, ...GATEWAY_TEXT_KEYS];

/** Tenant overrides of widget texts, as sent to the iframe. */
export type TextOverrides = Partial<Record<WidgetTextKey, string>>;

/** Default user-facing error texts (also shown in the admin as the defaults). Tenants override them with `texts.<locale>["errors.<code>"]`. */
export const ERROR_TEXTS: Readonly<Record<Locale, Readonly<Record<ErrorCode, string>>>> = {
  ro: {
    invalid_request: 'Mesajul nu a putut fi trimis. Verificați textul și încercați din nou.',
    tenant_not_found: 'Asistentul nu este disponibil pe acest site.',
    tenant_disabled: 'Asistentul nu este disponibil momentan pe acest site.',
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
    tenant_disabled: 'The assistant is currently not available on this site.',
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
