import type { Citation } from 'gateway/protocol';
import type { Texts } from '../i18n/index.js';
import { DocumentIcon } from './icons.js';

/** Source documents under an answer, one per document (grouped by the gateway, ADR 005). */
export function Citations({ citations, texts }: { citations: readonly Citation[]; texts: Texts }) {
  if (citations.length === 0) return null;
  return (
    <div class="citations">
      <p class="citations__label">{texts.citations.label}</p>
      <ul class="citations__list">
        {citations.map((citation) => (
          <li key={citation.documentId ?? citation.title} class="citations__item">
            {citation.snippet ? (
              <details>
                <summary>
                  <DocumentIcon size={14} />
                  {citation.title}
                </summary>
                <p class="citations__snippet">{citation.snippet}</p>
              </details>
            ) : (
              <span class="citations__title">
                <DocumentIcon size={14} />
                {citation.title}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
