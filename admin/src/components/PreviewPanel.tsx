import { useEffect, useRef, useState } from 'preact/hooks';
import { useI18n } from '../i18n.js';

const TOKEN_REUSE_MS = 8 * 60 * 1000; // tokens live 10 minutes on the server

interface PreviewPanelProps {
  /** Changes after every saved draft: the preview reloads with it. */
  revision: number;
  createToken: () => Promise<{ url: string }>;
}

/** Live preview of the draft in the real widget, desktop or phone width (spec §5.2). */
export function PreviewPanel({ revision, createToken }: PreviewPanelProps) {
  const { t, locale } = useI18n();
  const [mode, setMode] = useState<'desktop' | 'mobile'>('desktop');
  const [src, setSrc] = useState<string | undefined>();
  const [failed, setFailed] = useState(false);
  // The pending or obtained token request, shared by overlapping reloads.
  const token = useRef<{ url: Promise<string>; at: number } | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!token.current || Date.now() - token.current.at > TOKEN_REUSE_MS) {
        const request = createToken().then((result) => result.url);
        token.current = { url: request, at: Date.now() };
        request.catch(() => {
          token.current = undefined;
        });
      }
      // A changing query reloads the iframe after each saved draft.
      const url = `${await token.current.url}&locale=${locale}&r=${String(revision)}`;
      if (!cancelled) {
        setSrc(url);
        setFailed(false);
      }
    };
    load().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [revision, locale, createToken]);

  return (
    <section class="preview" aria-labelledby="preview-title">
      <div class="preview__head">
        <h2 id="preview-title">{t.preview.title}</h2>
        <div class="segmented" role="group" aria-label={t.preview.title}>
          {(['desktop', 'mobile'] as const).map((value) => (
            <button
              key={value}
              type="button"
              class="segmented__item"
              aria-pressed={mode === value}
              onClick={() => {
                setMode(value);
              }}
            >
              {t.preview[value]}
            </button>
          ))}
        </div>
      </div>
      <p class="field__hint">{t.preview.note}</p>
      <div class={`preview__stage preview__stage--${mode}`}>
        {failed ? (
          <p role="alert">{t.preview.unavailable}</p>
        ) : (
          src && <iframe class="preview__frame" title={t.preview.frame} src={src} />
        )}
      </div>
    </section>
  );
}
