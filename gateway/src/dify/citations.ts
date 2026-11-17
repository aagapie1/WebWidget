import type { Tenant } from '../config/tenants.js';
import type { Citation } from '../protocol/index.js';
import type { DifyRetrieverResource } from './schemas.js';

const SNIPPET_LENGTH = 280;

/**
 * Dify retriever resources → one citation per source document, ordered by position (ADR 005).
 * Titles come from the tenant mapping, otherwise the file name without extension; snippets only
 * when the tenant enables them.
 */
export function toCitations(
  resources: readonly DifyRetrieverResource[],
  tenant: Pick<Tenant, 'citations'>,
): Citation[] {
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const resource of [...resources].sort((a, b) => a.position - b.position)) {
    const fileName = resource.document_name ?? resource.dataset_name;
    if (!fileName) continue;
    const key = resource.document_id ?? fileName;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({
      position: resource.position,
      title: documentTitle(fileName, tenant),
      ...(resource.document_id ? { documentId: resource.document_id } : {}),
      ...(tenant.citations.showSnippets && resource.content
        ? { snippet: truncate(resource.content, SNIPPET_LENGTH) }
        : {}),
    });
  }
  return citations;
}

export function documentTitle(fileName: string, tenant: Pick<Tenant, 'citations'>): string {
  const mapped = tenant.citations.documentTitles[fileName];
  if (mapped) return mapped;
  return fileName.replace(/\.[a-z0-9]{1,5}$/i, '').trim() || fileName;
}

function truncate(text: string, length: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= length ? clean : `${clean.slice(0, length - 1).trimEnd()}…`;
}
