import type { ComponentChildren } from 'preact';
import { useId, useRef, useState } from 'preact/hooks';
import { useI18n } from '../i18n.js';

export type ContentLocale = 'ro' | 'en';
const LOCALES: readonly ContentLocale[] = ['ro', 'en'];

interface LocaleTabsProps {
  /** Names the tab list (e.g. "Limba textelor"). */
  label: string;
  /** Errors per language, shown on its tab so that nothing is hidden in the other one. */
  errors?: Partial<Record<ContentLocale, number>>;
  children: (locale: ContentLocale) => ComponentChildren;
}

/**
 * Română / English as tabs (WAI-ARIA tabs pattern): arrow keys, Home and End move between tabs and
 * select them; Tab goes into the panel.
 */
export function LocaleTabs({ label, errors = {}, children }: LocaleTabsProps) {
  const { t } = useI18n();
  const id = useId();
  const [selected, setSelected] = useState<ContentLocale>('ro');
  const tabs = useRef<Partial<Record<ContentLocale, HTMLButtonElement | null>>>({});
  const select = (locale: ContentLocale) => {
    setSelected(locale);
    tabs.current[locale]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const index = LOCALES.indexOf(selected);
    const next =
      event.key === 'ArrowRight'
        ? LOCALES[(index + 1) % LOCALES.length]
        : event.key === 'ArrowLeft'
          ? LOCALES[(index - 1 + LOCALES.length) % LOCALES.length]
          : event.key === 'Home'
            ? LOCALES[0]
            : event.key === 'End'
              ? LOCALES[LOCALES.length - 1]
              : undefined;
    if (!next) return;
    event.preventDefault();
    select(next);
  };
  return (
    <div class="locale-tabs">
      <div class="locale-tabs__list" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {LOCALES.map((locale) => {
          const count = errors[locale] ?? 0;
          return (
            <button
              key={locale}
              ref={(element) => {
                tabs.current[locale] = element;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${locale}`}
              aria-selected={locale === selected}
              aria-controls={`${id}-panel-${locale}`}
              tabIndex={locale === selected ? 0 : -1}
              class="locale-tabs__tab"
              onClick={() => {
                setSelected(locale);
              }}
            >
              {t.fields.textsFor[locale]}
              {count > 0 && (
                <span class="sidebar__count">
                  {count}
                  <span class="visually-hidden"> {t.ux.errorsCount(count)}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      {LOCALES.map((locale) => (
        <div
          key={locale}
          role="tabpanel"
          id={`${id}-panel-${locale}`}
          aria-labelledby={`${id}-tab-${locale}`}
          hidden={locale !== selected}
          class="locale-tabs__panel"
        >
          {locale === selected && children(locale)}
        </div>
      ))}
    </div>
  );
}
