import type { Rating } from 'gateway/protocol';
import type { Ref } from 'preact';
import { useState } from 'preact/hooks';
import type { Texts } from '../i18n/index.js';
import { ArrowLeftIcon, ThumbDownIcon, ThumbUpIcon } from './icons.js';

const MAX_COMMENT = 1000;

export interface ClosingFeedbackProps {
  texts: Texts;
  headingRef: Ref<HTMLHeadingElement>;
  onSubmit: (feedback: { rating: Rating; comment?: string }) => void;
  onSkip: () => void;
  onBack: () => void;
}

/** Shown by "Închide conversația": optional rating and comment (stored masked, ADR 005). */
export function ClosingFeedback({
  texts,
  headingRef,
  onSubmit,
  onSkip,
  onBack,
}: ClosingFeedbackProps) {
  const [rating, setRating] = useState<Rating | undefined>();
  const [comment, setComment] = useState('');

  return (
    <section class="panel-view" aria-labelledby="closing-title">
      <div class="panel-view__bar">
        <button type="button" class="text-button" onClick={onBack}>
          <ArrowLeftIcon size={18} />
          {texts.feedback.back}
        </button>
      </div>
      <form
        class="closing"
        onSubmit={(event) => {
          event.preventDefault();
          if (!rating) return;
          const text = comment.trim();
          onSubmit({ rating, ...(text ? { comment: text } : {}) });
        }}
      >
        <h2 id="closing-title" class="panel-view__title" tabIndex={-1} ref={headingRef}>
          {texts.feedback.closingTitle}
        </h2>
        <p class="panel-view__intro">{texts.feedback.closingIntro}</p>

        <fieldset class="rating">
          <legend class="visually-hidden">{texts.feedback.closingTitle}</legend>
          {(['like', 'dislike'] as const).map((value) => (
            <label key={value} class={`rating__option${rating === value ? ' is-selected' : ''}`}>
              <input
                type="radio"
                name="closing-rating"
                value={value}
                checked={rating === value}
                onChange={() => {
                  setRating(value);
                }}
              />
              {value === 'like' ? <ThumbUpIcon size={20} /> : <ThumbDownIcon size={20} />}
              <span>
                {value === 'like' ? texts.feedback.closingLike : texts.feedback.closingDislike}
              </span>
            </label>
          ))}
        </fieldset>

        <label class="closing__label" for="closing-comment">
          {texts.feedback.commentLabel}
        </label>
        <textarea
          id="closing-comment"
          class="closing__comment"
          rows={3}
          maxLength={MAX_COMMENT}
          aria-describedby="closing-hint"
          value={comment}
          onInput={(event) => {
            setComment(event.currentTarget.value);
          }}
        />
        <p id="closing-hint" class="closing__hint">
          {texts.feedback.commentHint}
        </p>

        <div class="closing__actions">
          <button type="submit" class="pill-button pill-button--primary" disabled={!rating}>
            {texts.feedback.send}
          </button>
          <button type="button" class="text-button" onClick={onSkip}>
            {texts.feedback.skip}
          </button>
        </div>
      </form>
    </section>
  );
}
