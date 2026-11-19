import { useEffect, useRef, useState } from 'preact/hooks';
import { useI18n } from '../i18n.js';
import {
  Code,
  Globe,
  MessageCircleMore,
  Palette,
  Quote,
  SlidersHorizontal,
  Type,
} from '../icons.js';
import type { Area } from './ConfigForm.js';
import { NodeIcon } from './OptionGrid.js';

export const AREAS: readonly Area[] = [
  'aspect',
  'texts',
  'proactive',
  'citations',
  'behavior',
  'domains',
  'integration',
];
const ICONS = {
  aspect: Palette,
  texts: Type,
  proactive: MessageCircleMore,
  citations: Quote,
  behavior: SlidersHorizontal,
  domains: Globe,
  integration: Code,
} as const;
export const ASPECT_SUBSECTIONS = ['identity', 'launcher', 'window', 'colors'] as const;

interface SidebarProps {
  area: Area;
  /** Areas with changes not yet published. */
  changed: ReadonlySet<Area>;
  /** Errors per area. */
  errors: Readonly<Partial<Record<Area, number>>>;
  /** Areas the user may see (e.g. the domains are for administrators). */
  visible?: readonly Area[];
  onArea: (area: Area, subsection?: string) => void;
}

/** One area at a time (like the Dify console); dot = unpublished changes, red = errors. */
export function Sidebar({ area, changed, errors, visible = AREAS, onArea }: SidebarProps) {
  const { t } = useI18n();
  // Under 1024 px the areas are a horizontal row (E4b.1 UX 19): a faded edge shows on the side
  // where more areas follow. Computed from the scroll position, so it disappears at the ends.
  const nav = useRef<HTMLElement>(null);
  const [more, setMore] = useState('');
  useEffect(() => {
    const element = nav.current;
    if (!element) return;
    const update = () => {
      const hidden = element.scrollWidth - element.clientWidth;
      const start = element.scrollLeft > 1;
      const end = hidden - element.scrollLeft > 1;
      setMore([start ? 'start' : '', end ? 'end' : ''].filter(Boolean).join(' '));
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      element.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return (
    <nav class="sidebar" aria-label={t.ux.navLabel} ref={nav} data-more={more || undefined}>
      <ul class="sidebar__list">
        {visible.map((item) => {
          const count = errors[item] ?? 0;
          return (
            <li key={item}>
              <a
                class="sidebar__item"
                href={`#${item}`}
                aria-current={item === area ? 'page' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  onArea(item);
                }}
              >
                <NodeIcon node={ICONS[item]} size={18} />
                <span class="sidebar__label">{t.ux.areas[item]}</span>
                {count > 0 ? (
                  <span class="sidebar__count" title={t.ux.errorsCount(count)}>
                    {count}
                    <span class="visually-hidden">{t.ux.errorsCount(count)}</span>
                  </span>
                ) : (
                  changed.has(item) && (
                    <span class="sidebar__dot" title={t.ux.legendChanged}>
                      <span class="visually-hidden">{t.ux.legendChanged}</span>
                    </span>
                  )
                )}
              </a>
              {item === 'aspect' && area === 'aspect' && (
                <ul class="sidebar__sub">
                  {ASPECT_SUBSECTIONS.map((sub) => (
                    <li key={sub}>
                      <a
                        href={`#section-${sub}`}
                        onClick={(event) => {
                          event.preventDefault();
                          onArea('aspect', sub);
                        }}
                      >
                        {t.ux.subsections[sub]}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <div class="sidebar__legend" aria-hidden="true">
        <span>
          <span class="sidebar__dot" /> {t.ux.legendChanged}
        </span>
        <span>
          <span class="sidebar__count">2</span> {t.ux.legendErrors}
        </span>
      </div>
    </nav>
  );
}
