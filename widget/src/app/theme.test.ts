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
