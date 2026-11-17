import type { Locale } from 'gateway/protocol';
import { en } from './en.js';
import { ro, type Texts } from './ro.js';

export type { Texts };
export type { Locale };

export const DEFAULT_LOCALE: Locale = 'ro';

const dictionaries: Readonly<Record<Locale, Texts>> = { ro, en };

export function texts(locale: Locale): Texts {
  return dictionaries[locale];
}

export function parseLocale(value: string | null | undefined): Locale {
  return value === 'en' ? 'en' : DEFAULT_LOCALE;
}
