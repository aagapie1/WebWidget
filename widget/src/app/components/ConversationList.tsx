import type { ConversationSummary, Locale } from 'gateway/protocol';
import type { Ref } from 'preact';
import { useState } from 'preact/hooks';
import type { Texts } from '../i18n/index.js';
import { ArrowLeftIcon, NewChatIcon, TrashIcon } from './icons.js';

export interface ConversationListProps {
  texts: Texts;
  locale: Locale;
  conversations: readonly ConversationSummary[];
  currentId: string | undefined;
  hasMore: boolean;
  loading: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  onBack: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => Promise<boolean>;
  onMore: () => void;
}

/** The visitor's conversations: open one, start a new one, delete with confirmation. */
export function ConversationList(props: ConversationListProps) {
  const { texts, locale, conversations, currentId, hasMore, loading, headingRef } = props;
  const [confirming, setConfirming] = useState<string | undefined>();
  const format = new Intl.DateTimeFormat(locale === 'ro' ? 'ro-RO' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <section class="panel-view" aria-labelledby="conversations-title" aria-busy={loading}>
      <div class="panel-view__bar">
        <button type="button" class="text-button" onClick={props.onBack}>
          <ArrowLeftIcon size={18} />
          {texts.conversations.back}
        </button>
      </div>
      <h2 id="conversations-title" class="panel-view__title" tabIndex={-1} ref={headingRef}>
        {texts.conversations.title}
      </h2>
      <button type="button" class="pill-button pill-button--wide" onClick={props.onNew}>
        <NewChatIcon size={18} />
        {texts.header.newConversation}
      </button>

      {conversations.length === 0 && !loading && (
        <p class="panel-view__empty">{texts.conversations.empty}</p>
      )}

      <ul class="conversation-list">
        {conversations.map((conversation) => {
          const title = conversation.title || texts.conversations.untitled;
          const current = conversation.id === currentId;
          const date = format.format(new Date(conversation.updatedAt * 1000));
          return (
            <li key={conversation.id} class="conversation-list__item">
              {confirming === conversation.id ? (
                <div class="confirm" role="group" aria-label={texts.conversations.delete(title)}>
                  <p class="confirm__text">{texts.conversations.confirmDelete}</p>
                  <div class="confirm__actions">
                    <button
                      type="button"
                      class="pill-button pill-button--danger"
                      // Focus lands here when the confirmation appears.
                      ref={(element) => element?.focus()}
                      onClick={() => {
                        void props.onDelete(conversation.id).then(() => {
                          setConfirming(undefined);
                        });
                      }}
                    >
                      {texts.conversations.confirm}
                    </button>
                    <button
                      type="button"
                      class="pill-button"
                      onClick={() => {
                        setConfirming(undefined);
                      }}
                    >
                      {texts.conversations.cancel}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    class="conversation-list__open"
                    aria-current={current ? 'true' : undefined}
                    onClick={() => {
                      props.onOpen(conversation.id);
                    }}
                  >
                    <span class="conversation-list__title">{title}</span>
                    <span class="conversation-list__meta">
                      {texts.conversations.updated(date)}
                      {current && ` · ${texts.conversations.current}`}
                    </span>
                  </button>
                  <button
                    type="button"
                    class="icon-button icon-button--muted"
                    aria-label={texts.conversations.delete(title)}
                    title={texts.conversations.delete(title)}
                    onClick={() => {
                      setConfirming(conversation.id);
                    }}
                  >
                    <TrashIcon size={18} />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>

      {hasMore && (
        <button type="button" class="text-button" onClick={props.onMore} disabled={loading}>
          {texts.conversations.more}
        </button>
      )}
    </section>
  );
}
