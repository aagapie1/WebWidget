import type { Ref } from 'preact';
import { useState } from 'preact/hooks';
import { MAX_MESSAGE_LENGTH } from 'gateway/protocol';
import type { Texts } from '../i18n/index.js';
import { SendIcon, StopIcon } from './icons.js';

export interface ComposerProps {
  texts: Texts;
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  inputRef: Ref<HTMLTextAreaElement>;
}

/** Message input. While an answer is generated the send button becomes "stop". */
export function Composer({ texts, busy, onSend, onStop, inputRef }: ComposerProps) {
  const [value, setValue] = useState('');

  const submit = () => {
    if (busy || value.trim() === '') return;
    onSend(value);
    setValue('');
  };

  return (
    <form
      class="composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div class="composer__field">
        <label class="visually-hidden" for="composer-input">
          {texts.composer.label}
        </label>
        <textarea
          id="composer-input"
          class="composer__input"
          ref={inputRef}
          rows={1}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder={texts.composer.placeholder}
          aria-describedby="composer-hint"
          value={value}
          onInput={(event) => {
            const element = event.currentTarget;
            setValue(element.value);
            // Grow with the text up to the CSS max-height.
            element.style.height = 'auto';
            element.style.height = `${String(element.scrollHeight)}px`;
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        {busy ? (
          <button
            type="button"
            class="round-button round-button--stop"
            aria-label={texts.composer.stop}
            title={texts.composer.stop}
            onClick={onStop}
          >
            <StopIcon size={18} />
          </button>
        ) : (
          <button
            type="submit"
            class="round-button"
            aria-label={texts.composer.send}
            title={texts.composer.send}
            disabled={value.trim() === ''}
          >
            <SendIcon size={18} />
          </button>
        )}
      </div>
      <p id="composer-hint" class="composer__hint">
        {texts.composer.hint}
      </p>
    </form>
  );
}
