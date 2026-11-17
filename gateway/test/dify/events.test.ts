import { describe, expect, it } from 'vitest';
import { DifyEventNormalizer } from '../../src/dify/events.js';
import { SseParser } from '../../src/protocol/sse.js';
import { chatStreamEventSchema, type ChatStreamEvent } from '../../src/protocol/index.js';
import { fixture, testTenant } from '../helpers.js';

function normalize(stream: string, locale: 'ro' | 'en' = 'ro'): ChatStreamEvent[] {
  const parser = new SseParser();
  const normalizer = new DifyEventNormalizer(testTenant, locale);
  const messages = [...parser.push(new TextEncoder().encode(stream)), ...parser.flush()];
  const events = messages.flatMap((message) => normalizer.handle(message).events);
  return [...events, ...normalizer.finish().events];
}

function data(payload: object): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

const ids = { task_id: 't1', message_id: 'm1', conversation_id: 'c1' };

describe('DifyEventNormalizer', () => {
  it('normalizes a chat app stream with deduplicated, ordered citations', () => {
    const events = normalize(fixture('dify-chat.sse'));
    for (const event of events) expect(chatStreamEventSchema.parse(event)).toEqual(event);

    expect(events).toEqual([
      {
        type: 'start',
        conversationId: '45701982-8118-4bc5-8e9b-64562b4555f2',
        messageId: '663c5084-a254-4040-8ad3-51f2a3c1a77c',
        taskId: '900bbd43-dc0b-4383-a372-aa6e6c414227',
        author: 'assistant',
      },
      { type: 'delta', text: 'Bună ziua! ' },
      { type: 'delta', text: 'Programul este luni–vineri, 8–16.' },
      {
        type: 'end',
        conversationId: '45701982-8118-4bc5-8e9b-64562b4555f2',
        messageId: '663c5084-a254-4040-8ad3-51f2a3c1a77c',
        citations: [
          // Tenant mapping for Regulament.pdf, file name without extension otherwise.
          { position: 1, documentId: 'doc-1', title: 'Regulamentul intern' },
          { position: 2, documentId: 'doc-2', title: 'Program' },
        ],
      },
    ]);
  });

  it('normalizes an agent app stream: agent_message becomes delta, thoughts are skipped', () => {
    const events = normalize(fixture('dify-agent.sse'));
    expect(events.map((event) => event.type)).toEqual(['start', 'delta', 'delta', 'end']);
    const text = events.flatMap((event) => (event.type === 'delta' ? [event.text] : [])).join('');
    expect(text).toBe('Puteți depune cererea online.');
  });

  it('normalizes the pilot Chatflow stream: workflow/node events skipped, ends at message_end', () => {
    // Captured from the pilot (advanced-chat app), ids and texts replaced (ADR 003).
    const events = normalize(fixture('dify-chatflow-pilot.sse'));
    const types = events.map((event) => event.type);
    expect(types[0]).toBe('start');
    expect(types.at(-1)).toBe('end');
    expect(types.filter((type) => type !== 'delta')).toEqual(['start', 'end']);
    const text = events.flatMap((event) => (event.type === 'delta' ? [event.text] : [])).join('');
    expect(text).toBe(
      'Centrul organizează cursuri de pregătire și perfecționare. Detalii găsiți pe site-ul instituției.',
    );
  });

  it('maps a Dify error event to a localized internal error and stops', () => {
    const events = normalize(
      data({ event: 'message', ...ids, answer: 'Parțial' }) +
        data({
          event: 'error',
          ...ids,
          status: 400,
          code: 'completion_request_error',
          message: 'boom',
        }) +
        data({ event: 'message', ...ids, answer: 'după eroare' }),
      'en',
    );
    expect(events).toEqual([
      expect.objectContaining({ type: 'start' }),
      { type: 'delta', text: 'Parțial' },
      {
        type: 'error',
        error: {
          code: 'model_error',
          message: 'The assistant could not produce an answer. Please try again.',
          retryable: true,
        },
      },
    ]);
  });

  it('does not leak the Dify error message to the client', () => {
    const events = normalize(
      data({ event: 'error', status: 500, code: 'x', message: 'secret trace' }),
    );
    expect(JSON.stringify(events)).not.toContain('secret trace');
  });

  it('reports an error when the stream ends without message_end', () => {
    const events = normalize(data({ event: 'message', ...ids, answer: 'Bună' }));
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      error: { code: 'upstream_unavailable', retryable: true },
    });
  });

  it('uses tenant texts for error messages', () => {
    const normalizer = new DifyEventNormalizer(testTenant, 'ro');
    expect(normalizer.fail('upstream_timeout').events).toEqual([
      {
        type: 'error',
        error: {
          code: 'upstream_timeout',
          message: 'Text personalizat pentru timeout.',
          retryable: true,
        },
      },
    ]);
  });

  it('emits message_replace as replace', () => {
    const events = normalize(
      data({ event: 'message', ...ids, answer: 'x' }) +
        data({ event: 'message_replace', ...ids, answer: 'Conținut moderat.' }) +
        data({ event: 'message_end', ...ids }),
    );
    expect(events.map((event) => event.type)).toEqual(['start', 'delta', 'replace', 'end']);
  });

  it('skips unknown events and fails on malformed known events', () => {
    const normalizer = new DifyEventNormalizer(testTenant, 'ro');
    expect(normalizer.handle({ event: undefined, data: '{"event":"workflow_started"}' })).toEqual({
      events: [],
      done: false,
      ignored: 'workflow_started',
    });
    const result = normalizer.handle({ event: undefined, data: '{"event":"message","answer":1}' });
    expect(result.done).toBe(true);
    expect(result.events[0]).toMatchObject({ type: 'error', error: { code: 'internal_error' } });
  });

  it('skips empty deltas but still emits start', () => {
    const events = normalize(
      data({ event: 'message', ...ids, answer: '' }) + data({ event: 'message_end', ...ids }),
    );
    expect(events.map((event) => event.type)).toEqual(['start', 'end']);
  });
});
