/** One Server-Sent Events message: optional `event:` name and the joined `data:` lines. */
export interface SseMessage {
  event: string | undefined;
  data: string;
}

/**
 * Incremental SSE parser (WHATWG event-stream format) for arbitrary byte chunks.
 * Handles UTF-8 sequences and CRLF pairs split between chunks.
 */
export class SseParser {
  readonly #decoder = new TextDecoder('utf-8');
  #buffer = '';
  #skipLeadingLf = false;
  #event: string | undefined;
  #data: string[] = [];

  push(chunk: Uint8Array): SseMessage[] {
    return this.#consume(this.#decoder.decode(chunk, { stream: true }), false);
  }

  /** Call when the stream ends, to dispatch a final message without trailing blank line. */
  flush(): SseMessage[] {
    return this.#consume(this.#decoder.decode(), true);
  }

  #consume(text: string, final: boolean): SseMessage[] {
    const messages: SseMessage[] = [];
    let input = this.#buffer + text;

    if (this.#skipLeadingLf && input.length > 0) {
      if (input.startsWith('\n')) input = input.slice(1);
      this.#skipLeadingLf = false;
    }

    let start = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      if (char !== '\n' && char !== '\r') continue;
      this.#processLine(input.slice(start, i), messages);
      if (char === '\r') {
        if (i + 1 < input.length) {
          if (input[i + 1] === '\n') i++;
        } else {
          // CR at the end of the chunk: an LF may follow in the next one.
          this.#skipLeadingLf = true;
        }
      }
      start = i + 1;
    }
    this.#buffer = input.slice(start);

    if (final) {
      if (this.#buffer.length > 0) this.#processLine(this.#buffer, messages);
      this.#buffer = '';
      this.#dispatch(messages);
    }
    return messages;
  }

  #processLine(line: string, messages: SseMessage[]): void {
    if (line === '') {
      this.#dispatch(messages);
      return;
    }
    if (line.startsWith(':')) return;

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'data') this.#data.push(value);
    else if (field === 'event') this.#event = value;
    // `id` and `retry` are not used by Dify.
  }

  #dispatch(messages: SseMessage[]): void {
    if (this.#data.length > 0 || this.#event !== undefined) {
      messages.push({ event: this.#event, data: this.#data.join('\n') });
    }
    this.#event = undefined;
    this.#data = [];
  }
}
