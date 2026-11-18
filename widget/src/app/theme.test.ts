import { describe, expect, it } from 'vitest';
import { applyTheme } from './theme.js';

describe('applyTheme', () => {
  it('maps the tenant colors to the CSS variables of the widget', () => {
    const element = document.createElement('div');
    applyTheme(element, {
      accent: '#0b6e4f',
      accentEnd: '#0a5c42',
      onAccent: '#ffffff',
      text: '#111111',
      textMuted: '#4f5868',
      background: '#ffffff',
      assistantBubble: '#eef6f2',
      link: '#0a5c42',
    });
    expect(element.style.getPropertyValue('--cw-accent')).toBe('#0b6e4f');
    expect(element.style.getPropertyValue('--cw-accent-2')).toBe('#0a5c42');
    expect(element.style.getPropertyValue('--cw-bubble')).toBe('#eef6f2');
    expect(element.style.getPropertyValue('--cw-focus')).toBe('#0a5c42');
  });
});

describe('applyTheme — optional colors', () => {
  const base = {
    accent: '#0b6e4f',
    accentEnd: '#0a5c42',
    onAccent: '#ffffff',
    text: '#111111',
    textMuted: '#4f5868',
    background: '#ffffff',
    assistantBubble: '#eef6f2',
    link: '#0a5c42',
  };

  it('sets user bubble and button colors only when configured (CSS falls back to the accent)', () => {
    const plain = document.createElement('div');
    applyTheme(plain, base);
    expect(plain.style.getPropertyValue('--cw-user-bg')).toBe('');
    expect(plain.style.getPropertyValue('--cw-button-bg')).toBe('');

    const custom = document.createElement('div');
    applyTheme(custom, {
      ...base,
      userBubble: '#e8f0fe',
      onUserBubble: '#0b2a5b',
      button: '#b42318',
      onButton: '#ffffff',
    });
    expect(custom.style.getPropertyValue('--cw-user-bg')).toBe('#e8f0fe');
    expect(custom.style.getPropertyValue('--cw-user-text')).toBe('#0b2a5b');
    expect(custom.style.getPropertyValue('--cw-button-bg')).toBe('#b42318');
    expect(custom.style.getPropertyValue('--cw-on-button')).toBe('#ffffff');
  });
});
