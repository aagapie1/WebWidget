import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { createRef } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ro } from '../i18n/ro.js';
import { ConversationList } from './ConversationList.js';

afterEach(cleanup);

const conversations = [
  { id: 'c1', title: 'Programul', updatedAt: 1_794_921_924 },
  { id: 'c2', title: '', updatedAt: 1_794_900_000 },
];

function setup(overrides: Partial<Parameters<typeof ConversationList>[0]> = {}) {
  const handlers = {
    onBack: vi.fn(),
    onNew: vi.fn(),
    onOpen: vi.fn(),
    onDelete: vi.fn(async () => true),
    onMore: vi.fn(),
  };
  render(
    <ConversationList
      texts={ro}
      locale="ro"
      conversations={conversations}
      currentId="c1"
      hasMore={false}
      loading={false}
      headingRef={createRef()}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe('ConversationList', () => {
  it('lists conversations with title, date and the current one marked', () => {
    setup();
    expect(screen.getByRole('heading', { level: 2, name: 'Conversațiile mele' })).toBeTruthy();
    const current = screen.getByRole('button', { name: /^Programul/ });
    expect(current.getAttribute('aria-current')).toBe('true');
    expect(current.textContent).toContain('conversația curentă');
    expect(screen.getByRole('button', { name: /^Conversație fără titlu/ })).toBeTruthy();
  });

  it('opens a conversation, starts a new one and goes back', () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole('button', { name: /^Conversație fără titlu/ }));
    expect(handlers.onOpen).toHaveBeenCalledWith('c2');
    fireEvent.click(screen.getByRole('button', { name: 'Conversație nouă' }));
    expect(handlers.onNew).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Înapoi la conversație' }));
    expect(handlers.onBack).toHaveBeenCalledOnce();
  });

  it('asks for confirmation before deleting and focuses the confirm button', async () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Șterge conversația „Programul”' }));
    expect(handlers.onDelete).not.toHaveBeenCalled();
    const confirm = screen.getByRole('button', { name: 'Șterge' });
    expect(document.activeElement).toBe(confirm);
    expect(screen.getByText('Ștergeți definitiv această conversație?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Anulează' }));
    expect(screen.queryByRole('button', { name: 'Șterge' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Șterge conversația „Programul”' }));
    fireEvent.click(screen.getByRole('button', { name: 'Șterge' }));
    await waitFor(() => {
      expect(handlers.onDelete).toHaveBeenCalledWith('c1');
    });
  });

  it('shows the empty state and the "more" button', () => {
    const handlers = setup({ conversations: [], hasMore: true });
    expect(screen.getByText('Nu aveți conversații anterioare.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mai multe conversații' }));
    expect(handlers.onMore).toHaveBeenCalledOnce();
  });
});
