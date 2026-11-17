import type { ChatStreamEvent } from 'gateway/protocol';
import { describe, expect, it, vi } from 'vitest';
import { ro } from '../i18n/ro.js';
import type { ChatTransport } from './api.js';
import { ScriptedTransport } from './scripted-transport.test-helper.js';
import { ChatController } from './controller.js';

const CONVERSATION = 'c-1';
const start: ChatStreamEvent = {
  type: 'start',
  conversationId: CONVERSATION,
  messageId: 'm',
  taskId: 'task-1',
  author: 'assistant',
};
const end: ChatStreamEvent = {
  type: 'end',
  conversationId: CONVERSATION,
  messageId: 'm',
  citations: [],
};

function controller(transport: ChatTransport) {
  return new ChatController({
    transport,
    texts: ro,
    schedule: (flush) => {
      flush();
    },
  });
}

const waitForAbort = (signal: AbortSignal) =>
  new Promise<void>((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      reject(new DOMException('aborted', 'AbortError'));
    });
  });

describe('ChatController', () => {
  it('shows the welcome message only while the conversation is empty', () => {
    const chat = controller(new ScriptedTransport([]));
    chat.setWelcome('  Bună ziua!  ');
    expect(chat.state.messages).toEqual([
      expect.objectContaining({ author: 'assistant', text: 'Bună ziua!', status: 'complete' }),
    ]);
  });

  it('streams an answer, keeps the conversation id and announces the full text once', async () => {
    const transport = new ScriptedTransport([
      async (emit) => {
        emit(start);
        emit({ type: 'delta', text: '**Program**: ' });
        emit({ type: 'delta', text: 'luni–vineri' });
        emit(end);
      },
      async (emit) => {
        emit(start);
        emit(end);
      },
    ]);
    const chat = controller(transport);
    const announcements: string[] = [];
    chat.subscribe((state) => {
      if (state.announcement.text && !announcements.includes(state.announcement.text)) {
        announcements.push(state.announcement.text);
      }
    });

    await chat.send('  Care e programul?  ');
    expect(chat.state.messages.map((m) => [m.author, m.text, m.status])).toEqual([
      ['user', 'Care e programul?', 'complete'],
      ['assistant', '**Program**: luni–vineri', 'complete'],
    ]);
    expect(chat.state.busy).toBe(false);
    expect(announcements).toEqual(['**Program**: luni–vineri']);

    await chat.send('Și sâmbăta?');
    expect(transport.requests).toEqual([
      { message: 'Care e programul?', conversationId: undefined },
      { message: 'Și sâmbăta?', conversationId: CONVERSATION },
    ]);
  });

  it('marks the answer busy while waiting, then streaming', async () => {
    let release!: () => void;
    const transport = new ScriptedTransport([
      async (emit) => {
        await new Promise<void>((resolve) => (release = resolve));
        emit(start);
        emit({ type: 'delta', text: 'a' });
        emit(end);
      },
    ]);
    const chat = controller(transport);
    const sending = chat.send('x');
    expect(chat.state.busy).toBe(true);
    expect(chat.state.messages.at(-1)?.status).toBe('waiting');
    release();
    await sending;
    expect(chat.state.messages.at(-1)?.status).toBe('complete');
  });

  it('ignores empty messages and sends while busy', async () => {
    const transport = new ScriptedTransport([
      async (emit, signal) => {
        emit(start);
        await waitForAbort(signal);
      },
    ]);
    const chat = controller(transport);
    await chat.send('   ');
    const first = chat.send('a');
    await chat.send('b');
    expect(transport.requests).toHaveLength(1);
    chat.stop();
    await first;
  });

  it('stops: aborts the stream, asks the gateway to stop the task, keeps the partial text', async () => {
    const transport = new ScriptedTransport([
      async (emit, signal) => {
        emit(start);
        emit({ type: 'delta', text: 'Parțial' });
        await waitForAbort(signal);
      },
    ]);
    const chat = controller(transport);
    const sending = chat.send('x');
    await Promise.resolve();
    chat.stop();
    await sending;
    expect(transport.stopped).toEqual(['task-1']);
    expect(chat.state.messages.at(-1)).toMatchObject({ text: 'Parțial', status: 'stopped' });
    expect(chat.state.announcement.text).toBe('Parțial Răspuns oprit.');
    expect(chat.state.busy).toBe(false);
  });

  it('shows retryable errors and retries without duplicating the question', async () => {
    const transport = new ScriptedTransport([
      async (emit) => {
        emit({
          type: 'error',
          error: { code: 'upstream_unavailable', message: 'Indisponibil.', retryable: true },
        });
      },
      async (emit) => {
        emit(start);
        emit({ type: 'delta', text: 'Acum merge.' });
        emit(end);
      },
    ]);
    const chat = controller(transport);
    await chat.send('Întrebare');
    expect(chat.state.messages.at(-1)).toMatchObject({
      status: 'error',
      error: { code: 'upstream_unavailable', retryable: true },
    });
    expect(chat.state.announcement.text).toBe('Indisponibil.');

    await chat.retry();
    expect(chat.state.messages.map((m) => [m.author, m.text, m.status])).toEqual([
      ['user', 'Întrebare', 'complete'],
      ['assistant', 'Acum merge.', 'complete'],
    ]);
    expect(transport.requests.map((r) => r.message)).toEqual(['Întrebare', 'Întrebare']);
  });

  it('reports a network failure as a retryable error', async () => {
    const transport = new ScriptedTransport([
      () => Promise.reject(new TypeError('Failed to fetch')),
    ]);
    const chat = controller(transport);
    await chat.send('x');
    expect(chat.state.messages.at(-1)).toMatchObject({
      status: 'error',
      error: { retryable: true, message: ro.errors.network },
    });
  });

  it('continues in a new conversation when the server lost the old one', async () => {
    const transport = new ScriptedTransport([
      async (emit) => {
        emit(start);
        emit(end);
      },
      async (emit) => {
        emit({
          type: 'error',
          error: { code: 'conversation_not_found', message: 'Expirată.', retryable: false },
        });
      },
      async (emit) => {
        emit({ ...start, conversationId: 'c-2' });
        emit({ type: 'delta', text: 'Răspuns nou.' });
        emit({ ...end, conversationId: 'c-2' });
      },
    ]);
    const chat = controller(transport);
    await chat.send('Prima');
    await chat.send('A doua');
    expect(transport.requests.map((r) => r.conversationId)).toEqual([
      undefined,
      CONVERSATION,
      undefined,
    ]);
    expect(chat.state.messages.map((m) => [m.author, m.text])).toEqual([
      ['user', 'Prima'],
      ['assistant', ''],
      ['user', 'A doua'],
      ['system', ro.messages.newConversationStarted],
      ['assistant', 'Răspuns nou.'],
    ]);
    expect(chat.conversationId).toBe('c-2');
  });

  it('starts a new conversation explicitly, stopping a running answer', async () => {
    const transport = new ScriptedTransport([
      async (emit, signal) => {
        emit(start);
        emit({ type: 'delta', text: 'în curs' });
        await waitForAbort(signal);
      },
    ]);
    const chat = controller(transport);
    chat.setWelcome('Bun venit!');
    const sending = chat.send('x');
    await Promise.resolve();
    chat.newConversation();
    await sending;
    expect(chat.state.messages.map((m) => m.text)).toEqual(['Bun venit!']);
    expect(chat.state.busy).toBe(false);
    expect(chat.conversationId).toBeUndefined();
    expect(chat.state.announcement.text).toBe(ro.messages.newConversationStarted);
    expect(transport.stopped).toEqual(['task-1']);
  });

  it('batches deltas through the scheduler', async () => {
    const flushes: (() => void)[] = [];
    const transport = new ScriptedTransport([
      async (emit) => {
        emit(start);
        emit({ type: 'delta', text: 'a' });
        emit({ type: 'delta', text: 'b' });
        expect(flushes).toHaveLength(1);
        flushes[0]?.();
        emit(end);
      },
    ]);
    const listener = vi.fn();
    const chat = new ChatController({
      transport,
      texts: ro,
      schedule: (flush) => flushes.push(flush),
    });
    chat.subscribe(listener);
    await chat.send('x');
    expect(chat.state.messages.at(-1)?.text).toBe('ab');
  });
});
