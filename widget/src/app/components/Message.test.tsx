import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../chat/controller.js';
import { ro } from '../i18n/ro.js';
import { Message } from './Message.js';

afterEach(cleanup);
describe('Message', () => {
  const base: ChatMessage = { id: '1', author: 'assistant', text: '', status: 'complete' };
  const show = (message: ChatMessage, canRetry = true, onRetry = vi.fn()) =>
    render(
      <ul>
        <Message
          message={message}
          assistantName="Ana"
          texts={ro}
          canRetry={canRetry}
          onRetry={onRetry}
        />
      </ul>,
    );

  it('renders sanitized Markdown for the assistant with a hidden author label', () => {
    const { container } = show({
      ...base,
      text: '**Gata** [link](https://a.ro) <img src=x onerror=alert(1)>',
    });
    expect(container.querySelector('strong')?.textContent).toBe('Gata');
    expect(container.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.visually-hidden')?.textContent).toBe('Ana: ');
  });

  it('renders user text as plain text, never HTML', () => {
    const { container } = show({ ...base, author: 'user', text: '<b>nu</b>' });
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<b>nu</b>');
  });

  it('is aria-busy with a typing indicator while waiting', () => {
    const { container } = show({ ...base, status: 'waiting' });
    expect(container.querySelector('li')?.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('Asistentul scrie…')).toBeTruthy();
  });

  it('is aria-busy while streaming and not busy once complete', () => {
    const { container, rerender } = show({ ...base, status: 'streaming', text: 'a' });
    expect(container.querySelector('li')?.getAttribute('aria-busy')).toBe('true');
    rerender(
      <ul>
        <Message
          message={{ ...base, text: 'a' }}
          assistantName="Ana"
          texts={ro}
          canRetry
          onRetry={vi.fn()}
        />
      </ul>,
    );
    expect(container.querySelector('li')?.getAttribute('aria-busy')).toBe('false');
  });

  it('offers retry only for retryable errors on the last message', () => {
    const onRetry = vi.fn();
    const error = {
      code: 'upstream_unavailable' as const,
      message: 'Indisponibil.',
      retryable: true,
    };
    show({ ...base, status: 'error', error }, true, onRetry);
    fireEvent.click(screen.getByRole('button', { name: 'Încearcă din nou' }));
    expect(onRetry).toHaveBeenCalledOnce();
    cleanup();
    show({ ...base, status: 'error', error: { ...error, retryable: false } });
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    show({ ...base, status: 'error', error }, false);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('marks a stopped answer', () => {
    show({ ...base, status: 'stopped', text: 'Parțial' });
    expect(screen.getByText('Răspuns oprit.')).toBeTruthy();
  });
});
