import type { WidgetTheme } from 'gateway/protocol';

/**
 * CSS custom properties used by styles.css, from the tenant theme (ADR 007). Optional colors
 * (user bubble, buttons) are only set when configured; the CSS falls back to the accent ones.
 */
const VARIABLES: Readonly<Record<keyof WidgetTheme, readonly string[]>> = {
  accent: ['--cw-accent'],
  accentEnd: ['--cw-accent-2'],
  onAccent: ['--cw-on-accent'],
  text: ['--cw-text'],
  textMuted: ['--cw-text-muted'],
  background: ['--cw-bg'],
  assistantBubble: ['--cw-bubble'],
  link: ['--cw-link', '--cw-focus'],
  userBubble: ['--cw-user-bg'],
  onUserBubble: ['--cw-user-text'],
  button: ['--cw-button-bg'],
  onButton: ['--cw-on-button'],
};

/** Sets the theme through the CSSOM (allowed by the strict CSP, unlike inline style attributes). */
export function applyTheme(element: HTMLElement, theme: WidgetTheme): void {
  for (const [key, names] of Object.entries(VARIABLES) as [
    keyof WidgetTheme,
    readonly string[],
  ][]) {
    const value = theme[key];
    if (!value) continue;
    for (const name of names) element.style.setProperty(name, value);
  }
}
