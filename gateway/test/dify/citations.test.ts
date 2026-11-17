import { describe, expect, it } from 'vitest';
import { documentTitle, toCitations } from '../../src/dify/citations.js';

const tenant = (showSnippets: boolean, documentTitles: Record<string, string> = {}) => ({
  citations: { showSnippets, documentTitles },
});

describe('toCitations', () => {
  const resources = [
    { position: 3, document_id: 'a', document_name: 'Ghid_inscriere.docx', content: 'fragment 3' },
    {
      position: 1,
      document_id: 'a',
      document_name: 'Ghid_inscriere.docx',
      content: '##  fragment\n 1',
    },
    { position: 2, document_id: 'b', document_name: 'Tarife 2026.pdf', content: 'fragment 2' },
    { position: 4, document_id: null, document_name: null, dataset_name: null, content: 'x' },
  ];

  it('groups by document, orders by position, hides snippets by default', () => {
    expect(toCitations(resources, tenant(false))).toEqual([
      { position: 1, documentId: 'a', title: 'Ghid_inscriere' },
      { position: 2, documentId: 'b', title: 'Tarife 2026' },
    ]);
  });

  it('shows the first snippet per document when the tenant enables it', () => {
    expect(toCitations(resources, tenant(true)).map((c) => c.snippet)).toEqual([
      '## fragment 1',
      'fragment 2',
    ]);
  });
});

describe('documentTitle', () => {
  it('uses the tenant mapping, otherwise drops the extension', () => {
    expect(documentTitle('Tarife 2026.pdf', tenant(false, { 'Tarife 2026.pdf': 'Tarife' }))).toBe(
      'Tarife',
    );
    expect(documentTitle('Regulament.v2.pdf', tenant(false))).toBe('Regulament.v2');
    expect(documentTitle('README', tenant(false))).toBe('README');
  });
});
