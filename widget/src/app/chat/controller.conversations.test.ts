import type { ChatStreamEvent, HistoryMessage } from 'gateway/protocol';
import { describe, expect, it } from 'vitest';
import { ro } from '../i18n/ro.js';
import { ApiError } from './api.js';
import { ChatController } from './controller.js';
import { ScriptedTransport, type StreamScript } from './scripted-transport.test-helper.js';

const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';

function msg(id: string, author: 'user' | 'assistant', text: string): HistoryMessage {
  return {
    id,
    author,
    text,
    createdAt: 1,
    citations: author === 'assistant' ? [{ position: 1, title: 'Regulament' }] : [],
    feedback: null,
    failed: false,
  };
}

function setup(scripts: StreamScript[] = []) {
  const transport = new ScriptedTransport(scripts);
  transport.conversations = {
    conversations: [
      { id: C1, title: 'Programul', updatedAt: 200 },
      { id: C2, title: 'Înscriere', updatedAt: 100 },
    ],
    hasMore: false,
  };
  transport.histories.set(C1, {
    messages: [msg('a:q', 'user', 'Care e programul?'), msg('a', 'assistant', 'Luni–vineri.')],
    hasMore: false,
  });
  transport.histories.set(C2, {
    messages: [msg('b:q', 'user', 'Cum mă înscriu?'), msg('b', 'assistant', 'Online.')],
    hasMore: false,
  });
  const chat = new ChatController({
    transport,
    texts: ro,
    schedule: (flush) => {
      flush();
    },
  });
  chat.setWelcome('Bun venit!');
  return { chat, transport };
}

const texts = (chat: ChatController) => chat.state.messages.map((m) => m.text);

describe('ChatController — conversations (E3)', () => {
  it('resumes the most recent conversation with its history after the welcome', async () => {
    const { chat } = setup();
    await chat.resumeLatest();
    expect(chat.conversationId).toBe(C1);
    expect(texts(chat)).toEqual(['Bun venit!', 'Care e programul?', 'Luni–vineri.']);
    const answer = chat.state.messages.at(-1);
    expect(answer).toMatchObject({ serverId: 'a', citations: [{ title: 'Regulament' }] });
    expect(chat.state.conversations).toHaveLength(2);
  });

  it('keeps the welcome when there is no history or the gateway fails', async () => {
    const { chat, transport } = setup();
    transport.conversations = { conversations: [], hasMore: false };
    await chat.resumeLatest();
    expect(texts(chat)).toEqual(['Bun venit!']);

    const other = setup();
    other.transport.failNext = new ApiError({
      code: 'upstream_unavailable',
      message: 'x',
      retryable: true,
    });
    await other.chat.resumeLatest();
    expect(texts(other.chat)).toEqual(['Bun venit!']);
  });

  it('switches conversation and continues it on the server', async () => {
    const end: ChatStreamEvent = { type: 'end', conversationId: C2, messageId: 'n', citations: [] };
    const { chat, transport } = setup([
      async (emit) => {
        emit({
          type: 'start',
          conversationId: C2,
          messageId: 'n',
          taskId: 't',
          author: 'assistant',
        });
        emit(end);
      },
    ]);
    await chat.resumeLatest();
    expect(await chat.openConversation(C2)).toBe(true);
    expect(texts(chat)).toEqual(['Bun venit!', 'Cum mă înscriu?', 'Online.']);
    expect(chat.state.announcement.text).toBe('Conversația „Înscriere” a fost deschisă.');
    await chat.send('Și taxa?');
    expect(transport.requests.at(-1)).toEqual({ message: 'Și taxa?', conversationId: C2 });
  });

  it('deletes a conversation; deleting the open one starts a new conversation', async () => {
    const { chat, transport } = setup();
    await chat.resumeLatest();
    expect(await chat.deleteConversation(C2)).toBe(true);
    expect(chat.conversationId).toBe(C1);
    expect(await chat.deleteConversation(C1)).toBe(true);
    expect(transport.deleted).toEqual([C2, C1]);
    expect(chat.state.conversations).toEqual([]);
    expect(chat.conversationId).toBeUndefined();
    expect(texts(chat)).toEqual(['Bun venit!']);
    expect(chat.state.announcement.text).toBe(ro.conversations.deleted);
  });

  it('reports a failed deletion and keeps the conversation', async () => {
    const { chat, transport } = setup();
    await chat.resumeLatest();
    transport.failNext = new ApiError({
      code: 'upstream_unavailable',
      message: 'Indisponibil.',
      retryable: true,
    });
    expect(await chat.deleteConversation(C1)).toBe(false);
    expect(chat.state.conversations).toHaveLength(2);
    expect(chat.state.announcement.text).toBe('Indisponibil.');
  });

  it('rates an answer, removes the rating on a second click, reverts on failure', async () => {
    const { chat, transport } = setup();
    await chat.resumeLatest();
    const id = chat.state.messages.at(-1)?.id ?? '';
    await chat.rate(id, 'like');
    expect(chat.state.messages.at(-1)?.feedback).toBe('like');
    await chat.rate(id, 'like');
    expect(chat.state.messages.at(-1)?.feedback).toBeNull();
    expect(transport.ratings).toEqual([
      ['a', 'like'],
      ['a', null],
    ]);
    transport.failNext = new ApiError({
      code: 'internal_error',
      message: 'Eroare.',
      retryable: true,
    });
    await chat.rate(id, 'dislike');
    expect(chat.state.messages.at(-1)?.feedback).toBeNull();
    expect(chat.state.announcement.text).toBe('Eroare.');
  });

  it('closes a conversation with feedback, then starts a new one', async () => {
    const { chat, transport } = setup();
    await chat.resumeLatest();
    await chat.closeConversation({ rating: 'dislike', comment: '  Prea lung  ' });
    expect(transport.closingFeedback).toEqual([[C1, 'dislike', 'Prea lung']]);
    expect(chat.conversationId).toBeUndefined();
    expect(texts(chat)).toEqual(['Bun venit!']);
    expect(chat.state.announcement.text).toBe(ro.feedback.closingThanks);
  });

  it('closes without feedback, and still closes when saving feedback fails', async () => {
    const { chat, transport } = setup();
    await chat.resumeLatest();
    await chat.closeConversation();
    expect(transport.closingFeedback).toEqual([]);
    expect(chat.state.announcement.text).toBe(ro.messages.newConversationStarted);

    await chat.openConversation(C2);
    transport.failNext = new ApiError({ code: 'internal_error', message: 'x', retryable: true });
    await chat.closeConversation({ rating: 'like' });
    expect(chat.conversationId).toBeUndefined();
    expect(chat.state.announcement.text).toBe(ro.feedback.notSaved);
  });

  it('marks answers that failed in the history', async () => {
    const { chat, transport } = setup();
    transport.histories.set(C1, {
      messages: [msg('x:q', 'user', 'Întrebare'), { ...msg('x', 'assistant', ''), failed: true }],
      hasMore: false,
    });
    await chat.resumeLatest();
    expect(chat.state.messages.at(-1)).toMatchObject({
      status: 'error',
      error: { message: ro.errors.answerFailed, retryable: false },
    });
  });

  it('stores suggestions and citations from a streamed answer', async () => {
    const { chat } = setup([
      async (emit) => {
        emit({
          type: 'start',
          conversationId: C1,
          messageId: 'z',
          taskId: 't',
          author: 'assistant',
        });
        emit({ type: 'delta', text: 'Da.' });
        emit({
          type: 'end',
          conversationId: C1,
          messageId: 'z',
          citations: [{ position: 1, title: 'Ghid' }],
        });
      },
    ]);
    chat.setSuggestions(['Care e programul?']);
    expect(chat.state.suggestions).toEqual(['Care e programul?']);
    await chat.send('Întrebare');
    expect(chat.state.messages.at(-1)).toMatchObject({
      serverId: 'z',
      citations: [{ title: 'Ghid' }],
    });
  });
});
