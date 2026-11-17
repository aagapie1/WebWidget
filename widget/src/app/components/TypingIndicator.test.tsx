import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { TypingIndicator } from './TypingIndicator.js';

afterEach(cleanup);

describe('TypingIndicator', () => {
  it('shows a visible label and hides the decorative dots from assistive tech', () => {
    const { container } = render(<TypingIndicator label="Asistentul scrie…" />);
    expect(screen.getByText('Asistentul scrie…')).toBeTruthy();
    expect(container.querySelector('.typing__dots')?.getAttribute('aria-hidden')).toBe('true');
  });
});
