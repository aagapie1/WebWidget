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

/** Every `a.b` path to a string in a dictionary (functions are not overridable). */
export function stringPaths(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, item]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof item === 'string') return [path];
    if (item !== null && typeof item === 'object') return stringPaths(item as object, path);
    return [];
  });
}

/**
 * Applies the tenant's text overrides (validated by the gateway against the known keys,
 * ADR 007). Unknown paths and non-string targets are ignored.
 */
export function withOverrides(base: Texts, overrides: Readonly<Record<string, string>>): Texts {
  const result = structuredCloneTexts(base);
  for (const [path, value] of Object.entries(overrides)) {
    const keys = path.split('.');
    const last = keys.pop();
    let target: Record<string, unknown> | undefined = result;
    for (const key of keys) {
      const next: unknown = target[key];
      target =
        next !== null && typeof next === 'object' ? (next as Record<string, unknown>) : undefined;
      if (!target) break;
    }
    if (target && last && typeof target[last] === 'string') target[last] = value;
  }
  return result;
}

/** Deep copy that keeps functions (structuredClone cannot copy them). */
function structuredCloneTexts<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, structuredCloneTexts(item as unknown)]),
  ) as T;
}
