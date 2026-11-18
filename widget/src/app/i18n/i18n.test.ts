import { WIDGET_TEXT_KEYS } from 'gateway/protocol';
import { describe, expect, it } from 'vitest';
import { en } from './en.js';
import { stringPaths, withOverrides } from './index.js';
import { ro } from './ro.js';

describe('UI texts', () => {
  it('the overridable keys known to the gateway match the dictionaries exactly', () => {
    const keys = [...WIDGET_TEXT_KEYS].sort();
    expect(stringPaths(ro).sort()).toEqual(keys);
    expect(stringPaths(en).sort()).toEqual(keys);
  });

  it('applies tenant overrides without touching the defaults or the functions', () => {
    const custom = withOverrides(ro, {
      'composer.placeholder': 'Întrebați primăria…',
      'header.subtitle': 'Asistent digital',
      'conversations.open': 'nu se poate',
      'unknown.key': 'ignorat',
    });
    expect(custom.composer.placeholder).toBe('Întrebați primăria…');
    expect(custom.header.subtitle).toBe('Asistent digital');
    expect(custom.conversations.open('X')).toBe('Deschide conversația „X”');
    expect(ro.composer.placeholder).toBe('Scrieți întrebarea dumneavoastră…');
  });
});
