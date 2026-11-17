import type { Texts } from '../i18n/index.js';

/** Initial suggested questions as buttons; a click sends the question. */
export function SuggestedQuestions({
  questions,
  texts,
  disabled,
  onAsk,
}: {
  questions: readonly string[];
  texts: Texts;
  disabled: boolean;
  onAsk: (question: string) => void;
}) {
  if (questions.length === 0) return null;
  return (
    <div class="suggestions" role="group" aria-label={texts.suggestions.label}>
      {questions.map((question) => (
        <button
          key={question}
          type="button"
          class="suggestions__button"
          disabled={disabled}
          onClick={() => {
            onAsk(question);
          }}
        >
          {question}
        </button>
      ))}
    </div>
  );
}
