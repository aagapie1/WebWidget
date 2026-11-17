// @vitest-environment happy-dom
// Under happy-dom DOMPurify does not actually sanitize (a happy-dom limitation). This simulates a
// misbehaving sanitizer: the allow-list self-check must fall back to escaped text.
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown.js';

describe('renderMarkdown without DOMPurify support', () => {
  it('escapes everything', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)><script>alert(1)</script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });
});
