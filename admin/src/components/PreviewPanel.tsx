import { useEffect, useRef, useState } from 'preact/hooks';
import { message, type PreviewControl, type PreviewState } from 'widget/messages';
import { useI18n } from '../i18n.js';

const TOKEN_REUSE_MS = 8 * 60 * 1000; // tokens live 10 minutes after their last use
export const KEEP_ALIVE_MS = 5 * 60 * 1000;

/** Any use of the preview id renews its token on the server. */
const touchPreview = (id: string): Promise<unknown> =>
  fetch(`/api/loader-config?tenant=${encodeURIComponent(id)}`, { cache: 'no-store' });

interface PreviewPanelProps {
  /** Changes after every saved draft: the preview reloads with it. */
  revision: number;
  createToken: () => Promise<{ url: string }>;
  keepAlive?: (id: string) => Promise<unknown>;
  /** What to show: follows the section being edited (launcher, proactive bubble, window). */
  show?: PreviewState;
  /** Window and launcher geometry of the draft: the desktop canvas is just big enough for them. */
  widget?: WidgetGeometry;
}

export interface WidgetGeometry {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

const DEFAULT_GEOMETRY: WidgetGeometry = { width: 380, height: 640, offsetX: 24, offsetY: 24 };
/** Phone frame (a common modern phone in CSS pixels). */
export const PHONE = { width: 390, height: 844 };

/**
 * The page size at which the widget shows at its real size (loader.js geometry): the window sits
 * 76 px above the bottom offset (launcher + gap) and keeps 130 px of the page height free.
 */
export function desktopCanvas(widget: WidgetGeometry): { width: number; height: number } {
  return {
    // Wider than the loader's phone breakpoint (480 px), which would make the window full screen.
    width: Math.max(widget.width + 2 * widget.offsetX + 40, 560),
    height: Math.max(widget.height + 130, widget.height + widget.offsetY + 76 + 32),
  };
}

/** Largest scale (at most 1) at which the canvas fits the available area. */
export function fitScale(
  canvas: { width: number; height: number },
  area: { width: number; height: number },
): number {
  if (area.width <= 0 || area.height <= 0) return 1;
  return Math.min(1, area.width / canvas.width, area.height / canvas.height);
}

/** Live preview of the draft in the real widget, desktop or phone width (spec §5.2). */
export function PreviewPanel({
  revision,
  createToken,
  keepAlive = touchPreview,
  show = 'window',
  widget = DEFAULT_GEOMETRY,
}: PreviewPanelProps) {
  const { t, locale } = useI18n();
  const [mode, setMode] = useState<'desktop' | 'mobile'>('desktop');
  const [src, setSrc] = useState<string | undefined>();
  const [failed, setFailed] = useState(false);
  // The pending or obtained token request, shared by overlapping reloads.
  const token = useRef<{ url: Promise<string>; at: number } | undefined>(undefined);
  const frame = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ width: 0, height: 0 });

  // The canvas is scaled down to fit the column (never cut off); the size of the column changes
  // with the window, the side panel and the switch between desktop and phone.
  useEffect(() => {
    const element = stage.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setArea({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  // Reloads start in the current state; changing the state itself does not reload.
  const showRef = useRef(show);
  showRef.current = show;

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
      const url = `${await token.current.url}&locale=${locale}&show=${showRef.current}&r=${String(revision)}`;
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

  // The loader in the preview page follows the section being edited (same origin only).
  useEffect(() => {
    frame.current?.contentWindow?.postMessage(
      message<PreviewControl>({ type: 'preview', show }),
      window.location.origin,
    );
  }, [show]);

  // The token expires 10 minutes after its last use: keep the open preview alive, even when
  // nothing is saved for a while (otherwise its widget stops answering).
  useEffect(() => {
    const timer = setInterval(() => {
      const current = token.current;
      if (!current) return;
      void current.url
        .then((url) => {
          const id = new URL(url, window.location.origin).searchParams.get('id');
          return id ? keepAlive(id) : undefined;
        })
        .catch(() => undefined);
    }, KEEP_ALIVE_MS);
    return () => {
      clearInterval(timer);
    };
  }, [keepAlive]);

  const canvas = mode === 'mobile' ? PHONE : desktopCanvas(widget);
  const scale = fitScale(canvas, area);
  const percent = Math.round(scale * 100);

  return (
    <section class="preview" aria-labelledby="preview-title">
      <div class="preview__head">
        <h2 id="preview-title" class="visually-hidden">
          {t.preview.title}
        </h2>
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
        {percent < 100 && (
          <span class="preview__scale" aria-live="polite">
            {t.ux.scaledTo(percent)}
          </span>
        )}
      </div>
      <div class="preview__stage" ref={stage}>
        {failed ? (
          <p role="alert">{t.preview.unavailable}</p>
        ) : (
          src && (
            <div
              class={`preview__canvas preview__canvas--${mode}`}
              style={{
                width: `${String(canvas.width * scale)}px`,
                height: `${String(canvas.height * scale)}px`,
              }}
            >
              <iframe
                ref={frame}
                class="preview__frame"
                title={t.preview.frame}
                src={src}
                style={{
                  width: `${String(canvas.width)}px`,
                  height: `${String(canvas.height)}px`,
                  transform: `scale(${String(scale)})`,
                }}
              />
            </div>
          )
        )}
      </div>
    </section>
  );
}
