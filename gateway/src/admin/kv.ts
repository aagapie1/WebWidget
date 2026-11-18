import { createClient } from 'redis';

/**
 * Small key-value contract for admin sessions, login state and rate limits (ADR 008: state in
 * Redis so the gateway stays stateless, rule 9).
 */
export interface KeyValueStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Reads and deletes in one step (single-use values such as login state). */
  take(key: string): Promise<string | undefined>;
  del(key: string): Promise<void>;
  /** Increments a counter; the TTL is set when the counter is created. Returns the new value. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  close(): Promise<void>;
}

/** The Redis commands used here (structural, so the client's generic types do not leak). */
interface RedisCommands {
  get(key: string): Promise<unknown>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  getDel(key: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  close(): Promise<unknown>;
}

export class RedisKeyValueStore implements KeyValueStore {
  private constructor(private readonly client: RedisCommands) {}

  static async connect(url: string): Promise<RedisKeyValueStore> {
    const client = createClient({ url });
    await client.connect();
    return new RedisKeyValueStore(client);
  }

  async get(key: string): Promise<string | undefined> {
    const value = await this.client.get(key);
    return typeof value === 'string' ? value : undefined;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, { EX: ttlSeconds });
  }

  async take(key: string): Promise<string | undefined> {
    const value = await this.client.getDel(key);
    return typeof value === 'string' ? value : undefined;
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const value = await this.client.incr(key);
    if (value === 1) await this.client.expire(key, ttlSeconds);
    return value;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

/** Tests only. */
export class MemoryKeyValueStore implements KeyValueStore {
  readonly #items = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  #read(key: string): string | undefined {
    const item = this.#items.get(key);
    if (!item) return undefined;
    if (item.expiresAt <= this.now()) {
      this.#items.delete(key);
      return undefined;
    }
    return item.value;
  }

  get(key: string): Promise<string | undefined> {
    return Promise.resolve(this.#read(key));
  }

  set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.#items.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
    return Promise.resolve();
  }

  take(key: string): Promise<string | undefined> {
    const value = this.#read(key);
    this.#items.delete(key);
    return Promise.resolve(value);
  }

  del(key: string): Promise<void> {
    this.#items.delete(key);
    return Promise.resolve();
  }

  incr(key: string, ttlSeconds: number): Promise<number> {
    const current = Number(this.#read(key) ?? '0') + 1;
    const existing = this.#items.get(key);
    this.#items.set(key, {
      value: String(current),
      expiresAt: existing && current > 1 ? existing.expiresAt : this.now() + ttlSeconds * 1000,
    });
    return Promise.resolve(current);
  }

  close(): Promise<void> {
    this.#items.clear();
    return Promise.resolve();
  }
}
