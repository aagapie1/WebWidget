import { describe, expect, it } from 'vitest';
import { ro } from '../i18n/ro.js';
import { ChatController } from './controller.js';
import { ScriptedTransport, type StreamScript } from './scripted-transport.test-helper.js';

const answer = (transport: ScriptedTransport) => (enabled: boolean) =>
  new ChatController({
    transport,
    texts: ro,
    suggestionsAfterAnswer: enabled,
    schedule: (flush) => {
      flush();
    },
  });

function setup(enabled: boolean) {
  const script: StreamScript = async (emit) => {
    emit({ type: 'start', conversationId: 'c', messageId: 'm1', taskId: 't', author: 'assistant' });
    emit({ type: 'delta', text: 'Da.' });
    emit({ type: 'end', conversationId: 'c', messageId: 'm1', citations: [] });
  };
  const transport = new ScriptedTransport([script, script]);
  transport.followUps = ['Și taxa?', 'Unde?'];
  return { transport, chat: answer(transport)(enabled) };
}

describe('ChatController — follow-up questions (opt-in)', () => {
  it('does not ask the gateway when the tenant has them off (default)', async () => {
    const { chat, transport } = setup(false);
    await chat.send('Întrebare');
    await Promise.resolve();
    expect(transport.suggestedFor).toEqual([]);
    expect(chat.state.followUps).toEqual([]);
  });

  it('loads them after an answer and clears them on the next question', async () => {
    const { chat, transport } = setup(true);
    await chat.send('Întrebare');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(transport.suggestedFor).toEqual(['m1']);
    expect(chat.state.followUps).toEqual(['Și taxa?', 'Unde?']);

    const next = chat.send('Și taxa?');
    expect(chat.state.followUps).toEqual([]);
    await next;
  });
});
