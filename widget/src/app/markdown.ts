import DOMPurify from 'dompurify';
import { Marked } from 'marked';

/**
 * Model output → safe HTML (CLAUDE.md rule 2, ADR 004).
 * - marked (GFM, line breaks) then DOMPurify with a strict allow-list;
 * - links: absolute http(s)/mailto/tel only, opened in a new tab with rel="noopener noreferrer"
 *   and a visually hidden "(opens in a new tab)" note;
 * - no images or media: they would make the browser contact third parties (rule 8).
 */
const marked = new Marked({ gfm: true, breaks: true, async: false });

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'b',
  'i',
  'del',
  's',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'a',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
];
const ALLOWED_ATTR = ['href', 'title', 'colspan', 'rowspan', 'start'];
const SAFE_URL = /^(?:https?:|mailto:|tel:)/i;

let purifier: ReturnType<typeof DOMPurify> | undefined;
let newTabNote = '(se deschide într-o filă nouă)';

function getPurifier(): ReturnType<typeof DOMPurify> {
  purifier ??= DOMPurify(window);
  return purifier;
}

const ALLOWED_TAG_SET = new Set(ALLOWED_TAGS.map((tag) => tag.toUpperCase()));
const ALLOWED_ATTR_SET = new Set(ALLOWED_ATTR);

function onlyAllowedMarkup(fragment: DocumentFragment): boolean {
  for (const element of fragment.querySelectorAll('*')) {
    if (!ALLOWED_TAG_SET.has(element.tagName.toUpperCase())) return false;
    for (const attribute of element.attributes) {
      if (!ALLOWED_ATTR_SET.has(attribute.name)) return false;
    }
  }
  return true;
}

/** Runs on the already sanitized fragment: only adds attributes and nodes we control. */
function decorateLinks(fragment: DocumentFragment): void {
  fragment.querySelectorAll('a').forEach((link) => {
    const href = link.getAttribute('href');
    if (!href || !SAFE_URL.test(href)) {
      link.removeAttribute('href');
      return;
    }
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    const note = link.ownerDocument.createElement('span');
    note.className = 'visually-hidden';
    note.textContent = ` ${newTabNote}`;
    link.append(note);
  });
}

export function setNewTabNote(text: string): void {
  newTabNote = text;
}

export function renderMarkdown(source: string): string {
  const purify = getPurifier();
  // DOMPurify returns its input unchanged when the environment is unsupported: never render
  // unsanitized HTML, fall back to escaped plain text.
  if (!purify.isSupported) return escapeHtml(source);
  const html = marked.parse(source) as string;
  const fragment = purify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: SAFE_URL,
    ALLOW_DATA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  // Defense in depth: verify the allow-list ourselves before adding our own nodes.
  if (!onlyAllowedMarkup(fragment)) return escapeHtml(source);
  decorateLinks(fragment);
  const container = document.createElement('div');
  container.append(fragment);
  return container.innerHTML;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br>');
}

/** Plain text of rendered Markdown, for the screen reader announcement. */
export function markdownToText(source: string): string {
  const container = document.createElement('div');
  container.innerHTML = renderMarkdown(source); // sanitized above
  container.querySelectorAll('.visually-hidden').forEach((note) => {
    note.remove();
  });
  return container.textContent.replace(/\s+/g, ' ').trim();
}
