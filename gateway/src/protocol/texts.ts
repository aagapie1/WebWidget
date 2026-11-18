/**
 * UI text keys a tenant may override (`texts.ro` / `texts.en`, ADR 007). Unknown keys are a
 * validation error. The widget test checks that this list matches its dictionaries exactly.
 */
export const WIDGET_TEXT_KEYS = [
  'launcher.open',
  'launcher.close',
  'frameTitle',
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
