import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ro } from '../i18n/ro.js';
import { SuggestedQuestions } from './SuggestedQuestions.js';

afterEach(cleanup);

describe('SuggestedQuestions', () => {
  it('is a labelled group of buttons that ask the question', () => {
    const onAsk = vi.fn();
    render(
      <SuggestedQuestions
        texts={ro}
        disabled={false}
        questions={['Care e programul?', 'Cum mă înscriu?']}
        onAsk={onAsk}
      />,
    );
    expect(screen.getByRole('group', { name: 'Întrebări sugerate' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cum mă înscriu?' }));
    expect(onAsk).toHaveBeenCalledWith('Cum mă înscriu?');
  });

  it('is disabled while an answer is generated and hidden without questions', () => {
    const { rerender, container } = render(
      <SuggestedQuestions texts={ro} disabled questions={['A?']} onAsk={vi.fn()} />,
    );
    expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(true);
    rerender(<SuggestedQuestions texts={ro} disabled={false} questions={[]} onAsk={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });
});
