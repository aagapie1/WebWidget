import { describe, expect, it } from 'vitest';
import { RedisFeedbackStore } from '../src/feedback/store.js';

// Runs against a real Redis when REDIS_URL is set (CI service container, ADR 005).
const url = process.env.REDIS_URL;

describe.skipIf(!url)('RedisFeedbackStore (real Redis)', () => {
  it('saves with a TTL, reads back and deletes', async () => {
    const store = await RedisFeedbackStore.connect(url ?? '');
    const conversation = `test-${String(Date.now())}`;
    try {
      await store.save(
        'e2e',
        conversation,
        { rating: 'like', comment: '[telefon]', createdAt: 1 },
        1,
      );
      expect(await store.get('e2e', conversation)).toEqual({
        rating: 'like',
        comment: '[telefon]',
        createdAt: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(await store.get('e2e', conversation)).toBeUndefined();

      await store.save('e2e', conversation, { rating: 'dislike', createdAt: 2 }, 60);
      await store.delete('e2e', conversation);
      expect(await store.get('e2e', conversation)).toBeUndefined();
    } finally {
      await store.close();
    }
  });
});

describe.skipIf(!url)('RedisKeyValueStore (real Redis, admin sessions)', () => {
  it('stores with a TTL, takes once and counts within a window', async () => {
    const { RedisKeyValueStore } = await import('../src/admin/kv.js');
    const store = await RedisKeyValueStore.connect(url ?? '');
    const key = `test:admin:${String(Date.now())}`;
    try {
      await store.set(key, 'v', 60);
      expect(await store.get(key)).toBe('v');
      expect(await store.take(key)).toBe('v');
      expect(await store.take(key)).toBeUndefined();

      expect(await store.incr(`${key}:n`, 1)).toBe(1);
      expect(await store.incr(`${key}:n`, 1)).toBe(2);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(await store.incr(`${key}:n`, 1)).toBe(1);
      await store.del(`${key}:n`);
    } finally {
      await store.close();
    }
  });
});
