import type { Tenant } from '../config/tenants.js';
import { chatError, mapDifyError } from '../errors/index.js';
import type { ChatStreamEvent, ErrorCode, Locale } from '../protocol/index.js';
import { toCitations } from './citations.js';
import { difyStreamEventSchema, type DifyStreamEvent } from './schemas.js';
import type { SseMessage } from '../protocol/sse.js';

export interface NormalizeResult {
  events: ChatStreamEvent[];
  /** True after `end` or `error`: the caller stops reading the upstream stream. */
  done: boolean;
  /** Dify event name that was skipped (unknown or not used yet), for debug logging. */
  ignored?: string;
}

/**
 * Converts the Dify SSE stream of one answer into internal protocol events (ADR 001).
 * Stateful: one instance per request.
 */
export class DifyEventNormalizer {
  readonly #locale: Locale;
  readonly #tenant: Tenant;
  #started = false;
  #done = false;
  #citedFiles: string[] = [];

  constructor(tenant: Tenant, locale: Locale) {
    this.#tenant = tenant;
    this.#locale = locale;
  }

  /** File names cited by the final answer (recorded for the admin; never sent to the browser). */
  get citedFiles(): readonly string[] {
    return this.#citedFiles;
  }

  get done(): boolean {
    return this.#done;
  }

  handle(message: SseMessage): NormalizeResult {
    if (this.#done) return { events: [], done: true };
    if (message.event === 'ping' || message.data === '') {
      return { events: [], done: false, ignored: message.event ?? 'empty' };
    }

    let json: unknown;
    try {
      json = JSON.parse(message.data);
    } catch {
      return this.#fail('internal_error');
    }

    const name =
      typeof json === 'object' && json !== null && 'event' in json ? json.event : undefined;
    if (typeof name !== 'string') return this.#fail('internal_error');

    const parsed = difyStreamEventSchema.safeParse(json);
    if (!parsed.success) {
      // Unknown events (workflow_*, message_file, tts_message…) are skipped; malformed known ones fail.
      const known = difyStreamEventSchema.options.some(
        (option) => option.shape.event.value === name,
      );
      return known ? this.#fail('internal_error') : { events: [], done: false, ignored: name };
    }
    return this.#handleEvent(parsed.data);
  }

  /** Call when the upstream stream ends. Emits an error if Dify never sent `message_end`. */
  finish(): NormalizeResult {
    if (this.#done) return { events: [], done: true };
    return this.#fail('upstream_unavailable');
  }

  /** Error raised outside the stream (timeout, connection reset). */
  fail(code: ErrorCode): NormalizeResult {
    if (this.#done) return { events: [], done: true };
    return this.#fail(code);
  }

  #handleEvent(event: DifyStreamEvent): NormalizeResult {
    switch (event.event) {
      case 'message':
      case 'agent_message':
        return {
          events: [
            ...this.#start(event),
            ...(event.answer ? [{ type: 'delta' as const, text: event.answer }] : []),
          ],
          done: false,
        };
      case 'message_replace':
        return {
          events: [...this.#start(event), { type: 'replace', text: event.answer }],
          done: false,
        };
      case 'agent_thought':
        // Tool calls and reasoning are not shown in E1; the answer arrives as agent_message.
        return { events: this.#start(event), done: false, ignored: event.event };
      case 'message_end':
        this.#done = true;
        this.#citedFiles = [
          ...new Set(
            (event.metadata?.retriever_resources ?? []).flatMap((resource) => {
              const name = resource.document_name ?? resource.dataset_name;
              return name ? [name] : [];
            }),
          ),
        ];
        return {
          events: [
            ...this.#start(event),
            {
              type: 'end',
              conversationId: event.conversation_id,
              messageId: event.message_id,
              citations: toCitations(event.metadata?.retriever_resources ?? [], this.#tenant),
            },
          ],
          done: true,
        };
      case 'error':
        return this.#fail(mapDifyError(event.status ?? undefined, event.code ?? undefined));
      case 'ping':
        return { events: [], done: false, ignored: 'ping' };
    }
  }

  #start(event: {
    task_id: string;
    message_id: string;
    conversation_id: string;
  }): ChatStreamEvent[] {
    if (this.#started) return [];
    this.#started = true;
    return [
      {
        type: 'start',
        conversationId: event.conversation_id,
        messageId: event.message_id,
        taskId: event.task_id,
        author: 'assistant',
      },
    ];
  }

  #fail(code: ErrorCode): NormalizeResult {
    this.#done = true;
    return {
      events: [{ type: 'error', error: chatError(code, this.#locale, this.#tenant) }],
      done: true,
    };
  }
}
