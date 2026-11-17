import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import type { ChatStreamEvent } from 'gateway/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { ChatController } from './chat/controller.js';
import { ScriptedTransport } from './chat/scripted-transport.test-helper.js';
import { ro } from './i18n/ro.js';

afterEach(cleanup);

function setup(events: ChatStreamEvent[]) {
  const transport = new ScriptedTransport([
    async (emit) => {
      for (const event of events) emit(event);
    },
  ]);
  const controller = new ChatController({
    transport,
    texts: ro,
    schedule: (flush) => {
      flush();
    },
  });
  controller.setWelcome('Bună ziua! Cu ce vă pot ajuta?');
  const onHide = vi.fn();
  const utils = render(
    <App controller={controller} texts={ro} assistantName="Ana" onHide={onHide} />,
  );
  return { ...utils, onHide, controller };
}

describe('App', () => {
  it('shows the welcome message and has no live region on the message list', () => {
    const { container } = setup([]);
    expect(screen.getByText('Bună ziua! Cu ce vă pot ajuta?')).toBeTruthy();
    const list = screen.getByRole('region', { name: 'Mesaje' });
    expect(list.getAttribute('aria-live')).toBeNull();
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(1);
  });

  it('sends a question and announces the complete answer once', async () => {
    setup([
      { type: 'start', conversationId: 'c', messageId: 'm', taskId: 't', author: 'assistant' },
      { type: 'delta', text: 'Programul este ' },
      { type: 'delta', text: '**8–16**.' },
      { type: 'end', conversationId: 'c', messageId: 'm', citations: [] },
    ]);
    const input = screen.getByLabelText('Mesajul dumneavoastră');
    fireEvent.input(input, { target: { value: 'Care e programul?' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
      await Promise.resolve();
    });
    expect(screen.getByText('Care e programul?')).toBeTruthy();
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe('Programul este **8–16**.');
  });

  it('hides on Escape (no focus trap) and from the minimize button', () => {
    const { onHide } = setup([]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onHide).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Minimizează fereastra' }));
    expect(onHide).toHaveBeenCalledTimes(2);
  });

  it('starts a new conversation and moves focus to the input', () => {
    setup([]);
    fireEvent.click(screen.getByRole('button', { name: 'Conversație nouă' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Mesajul dumneavoastră'));
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe(
      ro.messages.newConversationStarted,
    );
  });
});
