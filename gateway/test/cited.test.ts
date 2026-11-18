import { describe, expect, it } from 'vitest';
import { MemoryKeyValueStore } from '../src/admin/kv.js';
import { citedDocuments, recordCited } from '../src/cited/index.js';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-11-19T10:00:00.000Z');

describe('recently cited documents (E4b.1 UX 13)', () => {
  it('lists the cited file names per tenant, most recent first', async () => {
    const store = new MemoryKeyValueStore();
    await recordCited(store, 'pilot', ['regulament.pdf', 'taxe.pdf'], T0);
    await recordCited(store, 'pilot', ['program.docx'], T0 + 2 * DAY);
    await recordCited(store, 'alta', ['secret.pdf'], T0);
    expect((await citedDocuments(store, 'pilot', T0 + 2 * DAY)).map((d) => d.name)).toEqual([
      'program.docx',
      'regulament.pdf',
      'taxe.pdf',
    ]);
    expect(await citedDocuments(store, 'alta', T0)).toEqual([
      { name: 'secret.pdf', lastSeen: new Date(T0).toISOString() },
    ]);
  });

  it('writes a name again at most once a day', async () => {
    const store = new MemoryKeyValueStore();
    let writes = 0;
    const set = store.set.bind(store);
    store.set = (...args) => {
      writes += 1;
      return set(...args);
    };
    await recordCited(store, 'pilot', ['regulament.pdf'], T0);
    await recordCited(store, 'pilot', ['regulament.pdf'], T0 + 60_000);
    expect(writes).toBe(1);
    await recordCited(store, 'pilot', ['regulament.pdf'], T0 + DAY);
    expect(writes).toBe(2);
  });

  it('counts the admin preview for its tenant, and forgets after 90 days', async () => {
    const store = new MemoryKeyValueStore();
    await recordCited(store, 'pilot--p-abc123', ['ghid.pdf'], T0);
    expect((await citedDocuments(store, 'pilot', T0)).map((d) => d.name)).toEqual(['ghid.pdf']);
    expect(await citedDocuments(store, 'pilot', T0 + 91 * DAY)).toEqual([]);
  });
});
