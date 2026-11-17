import { createClient } from 'redis';
import type { Rating } from '../protocol/index.js';

/** Closing feedback of one conversation (ADR 005). The comment is already masked. */
export interface FeedbackRecord {
  rating: Rating;
  comment?: string;
  /** Unix milliseconds. */
  createdAt: number;
}

export interface FeedbackStore {
  save(
    tenant: string,
    conversationId: string,
    record: FeedbackRecord,
    ttlSeconds: number,
  ): Promise<void>;
  get(tenant: string, conversationId: string): Promise<FeedbackRecord | undefined>;
  delete(tenant: string, conversationId: string): Promise<void>;
  close(): Promise<void>;
}

const key = (tenant: string, conversationId: string) => `feedback:${tenant}:${conversationId}`;

/** The few Redis commands the store needs (keeps the store testable and the types simple). */
export interface KeyValueClient {
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  get(key: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  close(): Promise<unknown>;
}

/** Production store: Redis expiry enforces the retention period. */
export class RedisFeedbackStore implements FeedbackStore {
  readonly #client: KeyValueClient;

  constructor(client: KeyValueClient) {
    this.#client = client;
  }

  static async connect(url: string): Promise<RedisFeedbackStore> {
    const client = createClient({ url });
    await client.connect();
    return new RedisFeedbackStore(client);
  }

  async save(tenant: string, conversationId: string, record: FeedbackRecord, ttlSeconds: number) {
    await this.#client.set(key(tenant, conversationId), JSON.stringify(record), { EX: ttlSeconds });
  }

  async get(tenant: string, conversationId: string): Promise<FeedbackRecord | undefined> {
    const value = await this.#client.get(key(tenant, conversationId));
    return typeof value === 'string' ? (JSON.parse(value) as FeedbackRecord) : undefined;
  }

  async delete(tenant: string, conversationId: string) {
    await this.#client.del(key(tenant, conversationId));
  }

  async close() {
    await this.#client.close();
  }
}

/** Development and tests only (refused in production, see index.ts). Same TTL semantics. */
export class MemoryFeedbackStore implements FeedbackStore {
  readonly #items = new Map<string, { record: FeedbackRecord; expiresAt: number }>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  async save(tenant: string, conversationId: string, record: FeedbackRecord, ttlSeconds: number) {
    this.#items.set(key(tenant, conversationId), {
      record,
      expiresAt: this.#now() + ttlSeconds * 1000,
    });
    await Promise.resolve();
  }

  async get(tenant: string, conversationId: string): Promise<FeedbackRecord | undefined> {
    const item = this.#items.get(key(tenant, conversationId));
    await Promise.resolve();
    if (!item) return undefined;
    if (item.expiresAt <= this.#now()) {
      this.#items.delete(key(tenant, conversationId));
      return undefined;
    }
    return item.record;
  }

  async delete(tenant: string, conversationId: string) {
    this.#items.delete(key(tenant, conversationId));
    await Promise.resolve();
  }

  async close() {
    this.#items.clear();
    await Promise.resolve();
  }
}
