import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { createRef } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ro } from '../i18n/ro.js';
import { ClosingFeedback } from './ClosingFeedback.js';

afterEach(cleanup);

function setup() {
  const handlers = { onSubmit: vi.fn(), onSkip: vi.fn(), onBack: vi.fn() };
  render(<ClosingFeedback texts={ro} headingRef={createRef()} {...handlers} />);
  return handlers;
}

describe('ClosingFeedback', () => {
  it('has a heading, a labelled rating group and a described comment field', () => {
    setup();
    expect(screen.getByRole('heading', { level: 2, name: 'Cum a fost conversația?' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Utilă' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Neutilă' })).toBeTruthy();
    const comment = screen.getByLabelText<HTMLTextAreaElement>('Comentariu (opțional)');
    expect(comment.maxLength).toBe(1000);
    expect(
      document.getElementById(comment.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toContain('date personale');
  });

  it('sends the rating and the trimmed comment; send needs a rating', () => {
    const handlers = setup();
    const send = screen.getByRole<HTMLButtonElement>('button', { name: 'Trimite și închide' });
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Neutilă' }));
    fireEvent.input(screen.getByLabelText('Comentariu (opțional)'), {
      target: { value: '  Prea lung  ' },
    });
    fireEvent.click(send);
    expect(handlers.onSubmit).toHaveBeenCalledWith({ rating: 'dislike', comment: 'Prea lung' });
  });

  it('can close without rating or go back', () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Închide fără evaluare' }));
    fireEvent.click(screen.getByRole('button', { name: 'Înapoi la conversație' }));
    expect(handlers.onSkip).toHaveBeenCalledOnce();
    expect(handlers.onBack).toHaveBeenCalledOnce();
    expect(handlers.onSubmit).not.toHaveBeenCalled();
  });
});
