import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ro } from '../i18n/ro.js';
import { Header } from './Header.js';

afterEach(cleanup);

function setup(canClose: boolean) {
  const handlers = { onHide: vi.fn(), onShowConversations: vi.fn(), onCloseConversation: vi.fn() };
  render(<Header assistantName="Ana" texts={ro} canClose={canClose} {...handlers} />);
  return handlers;
}

describe('Header', () => {
  it('has a heading, the subtitle and labelled controls', () => {
    const handlers = setup(true);
    expect(screen.getByRole('heading', { level: 1, name: 'Ana' })).toBeTruthy();
    expect(screen.getByText('Asistent virtual')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Conversațiile mele' }));
    fireEvent.click(screen.getByRole('button', { name: 'Închide conversația' }));
    fireEvent.click(screen.getByRole('button', { name: 'Minimizează fereastra' }));
    expect(handlers.onShowConversations).toHaveBeenCalledOnce();
    expect(handlers.onCloseConversation).toHaveBeenCalledOnce();
    expect(handlers.onHide).toHaveBeenCalledOnce();
  });

  it('offers "Închide conversația" only when there is a conversation', () => {
    setup(false);
    expect(screen.queryByRole('button', { name: 'Închide conversația' })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});
