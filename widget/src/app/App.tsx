import { useEffect, useRef, useState } from 'preact/hooks';
import type { ChatController, ChatState } from './chat/controller.js';
import { Announcer } from './components/Announcer.js';
import { Composer } from './components/Composer.js';
import { Header } from './components/Header.js';
import { MessageList } from './components/MessageList.js';
import type { Texts } from './i18n/index.js';

export interface AppProps {
  controller: ChatController;
  texts: Texts;
  assistantName: string;
  /** Asks the loader to hide the window (minimize, X, Escape). */
  onHide: () => void;
  /** Called with a function that focuses the composer (used when the loader shows the window). */
  registerFocus?: (focus: () => void) => void;
}

export function App({ controller, texts, assistantName, onHide, registerFocus }: AppProps) {
  const [state, setState] = useState<ChatState>(controller.state);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => controller.subscribe(setState), [controller]);

  useEffect(() => {
    registerFocus?.(() => input.current?.focus());
  }, [registerFocus]);

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

  return (
    <div class="chat">
      <Header
        assistantName={assistantName}
        texts={texts}
        onNewConversation={() => {
          controller.newConversation();
          focusInput();
        }}
        onHide={onHide}
      />
      <MessageList
        messages={state.messages}
        assistantName={assistantName}
        texts={texts}
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
      <Announcer announcement={state.announcement} />
    </div>
  );
}
