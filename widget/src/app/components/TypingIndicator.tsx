/** Visible "typing…" state; the dots stop animating with prefers-reduced-motion (CSS). */
export function TypingIndicator({ label }: { label: string }) {
  return (
    <p class="typing">
      <span class="typing__dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span class="typing__label">{label}</span>
    </p>
  );
}
