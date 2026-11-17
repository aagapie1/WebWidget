import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';

const minimal = {
  PUBLIC_ORIGIN: 'http://localhost:3000/',
  VISITOR_COOKIE_SECRET: 'x'.repeat(32),
};

describe('loadEnv', () => {
  it('applies defaults and normalizes PUBLIC_ORIGIN', () => {
    const env = loadEnv(minimal);
    expect(env.PORT).toBe(3000);
    expect(env.PUBLIC_ORIGIN).toBe('http://localhost:3000');
    expect(env.DIFY_IDLE_TIMEOUT_MS).toBe(60_000);
  });

  it('rejects a short cookie secret without printing it', () => {
    expect(() => loadEnv({ ...minimal, VISITOR_COOKIE_SECRET: 'short-secret' })).toThrow(
      /VISITOR_COOKIE_SECRET/,
    );
    expect(() => loadEnv({ ...minimal, VISITOR_COOKIE_SECRET: 'short-secret' })).not.toThrow(
      /short-secret/,
    );
  });

  it('requires PUBLIC_ORIGIN', () => {
    expect(() => loadEnv({ VISITOR_COOKIE_SECRET: 'x'.repeat(32) })).toThrow(/PUBLIC_ORIGIN/);
  });
});
