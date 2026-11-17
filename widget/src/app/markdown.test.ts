import { describe, expect, it } from 'vitest';
import { markdownToText, renderMarkdown } from './markdown.js';

function dom(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

describe('renderMarkdown', () => {
  it('renders basic Markdown', () => {
    const html = renderMarkdown('**Program:**\n- luni\n- marți');
    expect(html).toContain('<strong>Program:</strong>');
    expect(dom(html).querySelectorAll('li')).toHaveLength(2);
  });

  it('opens safe links in a new tab with rel noopener noreferrer and a hidden note', () => {
    const link = dom(renderMarkdown('[Formular](https://www.primarie.ro/formular)')).querySelector(
      'a',
    );
    expect(link?.getAttribute('href')).toBe('https://www.primarie.ro/formular');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.querySelector('.visually-hidden')?.textContent).toContain('filă nouă');
  });

  it.each([
    ['script tags', '<script>alert(1)</script>text'],
    [
      'event handlers',
      '<p onclick="alert(1)">x</p><a href="https://a.ro" onmouseover="alert(1)">a</a>',
    ],
    ['javascript: links', '[click](javascript:alert(1))'],
    ['data: links', '<a href="data:text/html,<script>alert(1)</script>">x</a>'],
    ['iframes', '<iframe src="https://evil.example"></iframe>'],
    ['svg with script', '<svg><script>alert(1)</script></svg>'],
    ['style tags', '<style>body{display:none}</style>'],
    ['forms', '<form action="https://evil.example"><input name="cnp"></form>'],
  ])('neutralizes %s', (_label, input) => {
    const html = renderMarkdown(input);
    expect(html).not.toMatch(
      /<script|onclick|onmouseover|javascript:|data:text|<iframe|<svg|<style|<form|<input/i,
    );
  });

  it('removes images, including Markdown images to third parties', () => {
    const html = renderMarkdown(
      '![logo](https://tracker.example/pixel.png) <img src="https://x.example/a.png">',
    );
    expect(html).not.toContain('<img');
    expect(html).not.toContain('tracker.example');
  });

  it('drops relative links (they would point at the gateway)', () => {
    const link = dom(renderMarkdown('[intern](/admin)')).querySelector('a');
    expect(link?.hasAttribute('href')).toBe(false);
  });
});

describe('markdownToText', () => {
  it('returns readable text without the new-tab notes', () => {
    expect(markdownToText('**Bună ziua!** Vezi [site](https://a.ro).')).toBe(
      'Bună ziua! Vezi site.',
    );
  });
});
