import { describe, expect, it } from 'vitest';
import { SseParser, type SseMessage } from '../../src/dify/sse-parser.js';

const encoder = new TextEncoder();

function parseChunks(chunks: Uint8Array[]): SseMessage[] {
  const parser = new SseParser();
  return [...chunks.flatMap((chunk) => parser.push(chunk)), ...parser.flush()];
}

/** Splits bytes at every possible position pair to simulate arbitrary network chunking. */
function splitAt(bytes: Uint8Array, ...positions: number[]): Uint8Array[] {
  const parts: Uint8Array[] = [];
  let start = 0;
  for (const position of positions) {
    parts.push(bytes.slice(start, position));
    start = position;
  }
  parts.push(bytes.slice(start));
  return parts;
}

describe('SseParser', () => {
  it('parses data-only messages (Dify format)', () => {
    const input = encoder.encode('data: {"event":"message","answer":"Bună"}\n\ndata: {"a":1}\n\n');
    expect(parseChunks([input])).toEqual([
      { event: undefined, data: '{"event":"message","answer":"Bună"}' },
      { event: undefined, data: '{"a":1}' },
    ]);
  });

  it('parses named events without data (Dify ping)', () => {
    expect(parseChunks([encoder.encode('event: ping\n\n')])).toEqual([{ event: 'ping', data: '' }]);
  });

  it('joins multi-line data, ignores comments and handles CRLF', () => {
    const input = encoder.encode(': keep-alive\r\ndata: line1\r\ndata:line2\r\n\r\n');
    expect(parseChunks([input])).toEqual([{ event: undefined, data: 'line1\nline2' }]);
  });

  it('produces identical output for every way of splitting the stream in two', () => {
    const text = 'data: {"answer":"Răspuns în română: ăâîșț"}\r\n\r\nevent: ping\n\ndata: x\n\n';
    const bytes = encoder.encode(text);
    const expected = parseChunks([bytes]);
    for (let i = 0; i <= bytes.length; i++) {
      expect(parseChunks(splitAt(bytes, i))).toEqual(expected);
    }
  });

  it('decodes multi-byte UTF-8 characters split across chunks', () => {
    const bytes = encoder.encode('data: ș\n\n');
    // "ș" is two bytes (0xC8 0x99) starting at index 6.
    expect(parseChunks(splitAt(bytes, 7))).toEqual([{ event: undefined, data: 'ș' }]);
  });

  it('handles CRLF split between chunks without emitting an empty message', () => {
    const bytes = encoder.encode('data: a\r\n\r\n');
    expect(parseChunks(splitAt(bytes, 8, 10))).toEqual([{ event: undefined, data: 'a' }]);
  });

  it('dispatches a trailing message without final blank line on flush', () => {
    expect(parseChunks([encoder.encode('data: last')])).toEqual([
      { event: undefined, data: 'last' },
    ]);
  });
});
