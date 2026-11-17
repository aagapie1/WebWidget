import { describe, expect, it } from 'vitest';
import { chatError, mapDifyError } from '../src/errors/index.js';
import { ERROR_CODES } from '../src/protocol/index.js';
import { testTenant } from './helpers.js';

describe('mapDifyError', () => {
  it.each([
    [404, 'not_found', 'conversation_not_found'],
    [400, 'invalid_param', 'internal_error'],
    [400, 'app_unavailable', 'configuration_error'],
    [400, 'provider_quota_exceeded', 'rate_limited'],
    [400, 'completion_request_error', 'model_error'],
    [401, undefined, 'configuration_error'],
    [403, undefined, 'configuration_error'],
    [429, undefined, 'rate_limited'],
    [502, undefined, 'upstream_unavailable'],
    [503, undefined, 'upstream_unavailable'],
    [500, 'unknown_code', 'model_error'],
    [undefined, undefined, 'model_error'],
  ] as const)('status %s, code %s → %s', (status, code, expected) => {
    expect(mapDifyError(status, code)).toBe(expected);
  });
});

describe('chatError', () => {
  it('has a Romanian and English default text for every code', () => {
    for (const code of ERROR_CODES) {
      expect(chatError(code, 'ro').message).not.toBe('');
      expect(chatError(code, 'en').message).not.toBe('');
      expect(chatError(code, 'ro').message).not.toBe(chatError(code, 'en').message);
    }
  });

  it('prefers the tenant text', () => {
    expect(chatError('upstream_timeout', 'ro', testTenant).message).toBe(
      'Text personalizat pentru timeout.',
    );
    expect(chatError('upstream_timeout', 'en', testTenant).message).toMatch(/too long/);
  });
});
