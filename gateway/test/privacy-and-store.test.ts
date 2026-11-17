import { describe, expect, it } from 'vitest';
import { MemoryFeedbackStore } from '../src/feedback/store.js';
import { maskPersonalData } from '../src/privacy/mask.js';

describe('maskPersonalData', () => {
  it.each([
    ['CNP-ul meu este 1960523123456.', 'CNP-ul meu este [CNP].'],
    ['Sunați la 0722 123 456 sau +40 722-123-457.', 'Sunați la [telefon] sau [telefon].'],
    ['Telefon fix: (021) 312.34.56', 'Telefon fix: [telefon]'],
    ['Scrieți-mi la ana.popescu+cursuri@exemplu.ro', 'Scrieți-mi la [email]'],
    ['Adresă cu diacritice: ștefan@școală.ro', 'Adresă cu diacritice: [email]'],
  ])('masks %s', (input, expected) => {
    expect(maskPersonalData(input)).toBe(expected);
  });

  it('keeps ordinary text and short numbers', () => {
    const text = 'Cursul durează 5 zile, grupa 12, sala 104, anul 2026.';
    expect(maskPersonalData(text)).toBe(text);
  });
});

describe('MemoryFeedbackStore', () => {
  it('stores, expires after the TTL and deletes', async () => {
    let now = 1_000_000;
    const store = new MemoryFeedbackStore(() => now);
    await store.save('pilot', 'c1', { rating: 'like', createdAt: now }, 60);
    expect(await store.get('pilot', 'c1')).toEqual({ rating: 'like', createdAt: 1_000_000 });
    expect(await store.get('other', 'c1')).toBeUndefined();

    now += 61_000;
    expect(await store.get('pilot', 'c1')).toBeUndefined();

    await store.save('pilot', 'c2', { rating: 'dislike', createdAt: now }, 60);
    await store.delete('pilot', 'c2');
    expect(await store.get('pilot', 'c2')).toBeUndefined();
  });
});
