import type { Ref } from 'preact';
import { useState } from 'preact/hooks';
import { MAX_MESSAGE_LENGTH } from 'gateway/protocol';
import type { Texts } from '../i18n/index.js';

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
      <label class="visually-hidden" for="composer-input">
        {texts.composer.label}
      </label>
      <textarea
        id="composer-input"
        class="composer__input"
        ref={inputRef}
        rows={2}
        maxLength={MAX_MESSAGE_LENGTH}
        placeholder={texts.composer.placeholder}
        aria-describedby="composer-hint"
        value={value}
        onInput={(event) => {
          setValue(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <p id="composer-hint" class="composer__hint">
        {texts.composer.hint}
      </p>
      {busy ? (
        <button type="button" class="button button--primary composer__button" onClick={onStop}>
          {texts.composer.stop}
        </button>
      ) : (
        <button
          type="submit"
          class="button button--primary composer__button"
          disabled={value.trim() === ''}
        >
          {texts.composer.send}
        </button>
      )}
    </form>
  );
}
