import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ro } from '../i18n/ro.js';
import { MessageRating } from './MessageRating.js';

afterEach(cleanup);

describe('MessageRating', () => {
  it('exposes the current rating with aria-pressed and reports clicks', () => {
    const onRate = vi.fn();
    render(<MessageRating value="like" texts={ro} onRate={onRate} />);
    expect(screen.getByRole('group', { name: 'Evaluați răspunsul' })).toBeTruthy();
    const like = screen.getByRole('button', { name: 'Răspuns util' });
    const dislike = screen.getByRole('button', { name: 'Răspuns neutil' });
    expect(like.getAttribute('aria-pressed')).toBe('true');
    expect(dislike.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(dislike);
    expect(onRate).toHaveBeenCalledWith('dislike');
  });
});
