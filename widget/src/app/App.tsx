import type { Locale } from 'gateway/protocol';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ChatController, ChatState } from './chat/controller.js';
import { Announcer } from './components/Announcer.js';
import type { Identity } from './components/Avatar.js';
import { ClosingFeedback } from './components/ClosingFeedback.js';
import { Composer } from './components/Composer.js';
import { ConversationList } from './components/ConversationList.js';
import { Header } from './components/Header.js';
import { MessageList } from './components/MessageList.js';
import type { Texts } from './i18n/index.js';

export interface AppProps {
  controller: ChatController;
  texts: Texts;
  locale?: Locale;
  assistantName: string;
  /** Tenant images (logo, avatars). */
  identity?: Identity;
  /** Asks the loader to hide the window (minimize, Escape). */
  onHide: () => void;
  /** Called with a function that focuses the composer (used when the loader shows the window). */
  registerFocus?: (focus: () => void) => void;
}

type View = 'chat' | 'conversations' | 'closing';

export function App({
  controller,
  texts,
  locale = 'ro',
  assistantName,
  identity = {},
  onHide,
  registerFocus,
}: AppProps) {
  const [state, setState] = useState<ChatState>(controller.state);
  const [view, setView] = useState<View>('chat');
  const input = useRef<HTMLTextAreaElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const viewRef = useRef<View>('chat');
  viewRef.current = view;

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    // Effects run late in a hidden (preloaded) iframe: the history may have arrived between the
    // first render and this subscription. Catch up with the current state.
    setState(controller.state);
    return unsubscribe;
  }, [controller]);

  useEffect(() => {
    registerFocus?.(() => {
      // The frame was display:none until now; focus once it has been laid out again.
      requestAnimationFrame(() => {
        if (viewRef.current === 'chat') input.current?.focus();
        else heading.current?.focus();
      });
    });
  }, [registerFocus]);

  // Moving between views moves focus to the new view (its heading, or the input in the chat).
  // Not on mount: opening the window focuses through `shown`, and a visible frame (the admin
  // preview) must not take the focus from the page around it.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (view === 'chat') input.current?.focus();
    else heading.current?.focus();
  }, [view]);

  // Escape minimizes the window; the loader returns focus to its launcher. No focus trap.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        onHide();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onHide]);

  const focusInput = () => input.current?.focus();
  const showChat = () => {
    setView('chat');
  };

  return (
    <div class="chat">
      <Header
        assistantName={assistantName}
        texts={texts}
        canClose={view === 'chat' && state.conversationId !== undefined}
        avatar={
          identity.logoUrl ? { kind: 'image', url: identity.logoUrl } : identity.assistantAvatar
        }
        onShowConversations={() => {
          setView('conversations');
          void controller.refreshConversations();
        }}
        onCloseConversation={() => {
          setView('closing');
        }}
        onHide={onHide}
      />

      {view === 'conversations' && (
        <ConversationList
          texts={texts}
          locale={locale}
          conversations={state.conversations}
          currentId={state.conversationId}
          hasMore={state.conversationsHasMore}
          loading={state.loading}
          headingRef={heading}
          onBack={showChat}
          onNew={() => {
            controller.newConversation();
            showChat();
          }}
          onOpen={(id) => {
            void controller.openConversation(id).then((opened) => {
              if (opened) showChat();
            });
          }}
          onDelete={(id) => controller.deleteConversation(id)}
          onMore={() => void controller.loadMoreConversations()}
        />
      )}

      {view === 'closing' && (
        <ClosingFeedback
          texts={texts}
          headingRef={heading}
          onBack={showChat}
          onSkip={() => {
            void controller.closeConversation();
            showChat();
          }}
          onSubmit={(feedback) => {
            void controller.closeConversation(feedback);
            showChat();
          }}
        />
      )}

      {view === 'chat' && (
        <>
          <MessageList
            messages={state.messages}
            assistantName={assistantName}
            texts={texts}
            busy={state.busy}
            suggestions={state.suggestions}
            followUps={state.followUps}
            identity={identity}
            hasOlder={state.hasOlder}
            loading={state.loading}
            onLoadOlder={() => void controller.loadOlder()}
            onAsk={(question) => {
              focusInput();
              void controller.send(question);
            }}
            onRate={(id, rating) => void controller.rate(id, rating)}
            onRetry={() => {
              focusInput();
              void controller.retry();
            }}
          />
          <Composer
            texts={texts}
            busy={state.busy}
            inputRef={input}
            onSend={(text) => void controller.send(text)}
            onStop={() => {
              controller.stop();
              focusInput();
            }}
          />
        </>
      )}
      <Announcer announcement={state.announcement} />
    </div>
  );
}
