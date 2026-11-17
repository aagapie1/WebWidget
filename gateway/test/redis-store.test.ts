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
