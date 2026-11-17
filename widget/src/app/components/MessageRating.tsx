import type { Rating } from 'gateway/protocol';
import type { Texts } from '../i18n/index.js';
import { ThumbDownIcon, ThumbUpIcon } from './icons.js';

/** 👍/👎 for one answer; the pressed state is exposed with aria-pressed. */
export function MessageRating({
  value,
  texts,
  onRate,
}: {
  value: Rating | null | undefined;
  texts: Texts;
  onRate: (rating: Rating) => void;
}) {
  return (
    <div class="rating-buttons" role="group" aria-label={texts.feedback.group}>
      <button
        type="button"
        class="rating-buttons__button"
        aria-pressed={value === 'like'}
        aria-label={texts.feedback.like}
        title={texts.feedback.like}
        onClick={() => {
          onRate('like');
        }}
      >
        <ThumbUpIcon size={16} />
      </button>
      <button
        type="button"
        class="rating-buttons__button"
        aria-pressed={value === 'dislike'}
        aria-label={texts.feedback.dislike}
        title={texts.feedback.dislike}
        onClick={() => {
          onRate('dislike');
        }}
      >
        <ThumbDownIcon size={16} />
      </button>
    </div>
  );
}
