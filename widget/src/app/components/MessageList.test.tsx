import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../chat/controller.js';
import { ro } from '../i18n/ro.js';
import { MessageList } from './MessageList.js';

afterEach(cleanup);

const error = { code: 'model_error' as const, message: 'Eroare.', retryable: true };

describe('MessageList', () => {
  it('is a labelled, focusable region without aria-live', () => {
    render(<MessageList messages={[]} assistantName="Ana" texts={ro} onRetry={vi.fn()} />);
    const region = screen.getByRole('region', { name: 'Mesaje' });
    expect(region.tabIndex).toBe(0);
    expect(region.getAttribute('aria-live')).toBeNull();
  });

  it('renders messages in order and offers retry only on the last one', () => {
    const messages: ChatMessage[] = [
      { id: '1', author: 'assistant', text: 'Vechi', status: 'error', error },
      { id: '2', author: 'user', text: 'Întrebare', status: 'complete' },
      { id: '3', author: 'assistant', text: '', status: 'error', error },
    ];
    render(<MessageList messages={messages} assistantName="Ana" texts={ro} onRetry={vi.fn()} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Încearcă din nou' })).toHaveLength(1);
  });
});
