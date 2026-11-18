import { contrastRatio } from 'gateway/contrast';
import { contrastChecks, DEFAULT_THEME, tenantSchema, type Theme } from 'gateway/config-schema';
import type { Config } from './api.js';
import type { Dictionary } from './i18n.js';

export type Path = readonly string[];

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function getIn(config: unknown, path: Path): unknown {
  let current = config;
  for (const key of path) {
    if (!isObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * Immutable update. `undefined` (an emptied field) removes the key, and empty parent objects
 * are removed too, so the schema defaults apply.
 */
export function setIn(config: Config, path: Path, value: unknown): Config {
  const [key, ...rest] = path;
  if (key === undefined) return config;
  const child =
    rest.length === 0 ? value : setIn(isObject(config[key]) ? config[key] : {}, rest, value);
  if (child === undefined || (isObject(child) && Object.keys(child).length === 0)) {
    return Object.fromEntries(Object.entries(config).filter(([name]) => name !== key));
  }
  return { ...config, [key]: child };
}

/** Top-level keys mapped to the form sections (publish summary). */
const SECTION_OF: Record<string, string> = {
  name: 'identity',
  identity: 'identity',
  launcher: 'launcher',
  window: 'window',
  theme: 'window',
  texts: 'texts',
  proactive: 'proactive',
  citations: 'citations',
  behavior: 'behavior',
  allowedOrigins: 'allowedOrigins',
  feedback: 'feedback',
};
export const SECTION_ORDER = [
  'identity',
  'launcher',
  'window',
  'texts',
  'proactive',
  'citations',
  'behavior',
  'allowedOrigins',
  'feedback',
];

export function changedSections(published: Config, draft: Config): string[] {
  const keys = new Set([...Object.keys(published), ...Object.keys(draft)]);
  const sections = new Set<string>();
  for (const key of keys) {
    if (JSON.stringify(published[key]) !== JSON.stringify(draft[key])) {
      sections.add(SECTION_OF[key] ?? key);
    }
  }
  return SECTION_ORDER.filter((section) => sections.has(section)).concat(
    [...sections].filter((section) => !SECTION_ORDER.includes(section)),
  );
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** The colors the widget will use: valid values from the draft, defaults otherwise. */
export function effectiveTheme(config: Config): Theme {
  const theme = getIn(config, ['theme']);
  const result: Record<string, string> = { ...DEFAULT_THEME };
  if (isObject(theme)) {
    for (const [key, value] of Object.entries(theme)) {
      if (typeof value === 'string' && HEX.test(value)) result[key] = value;
    }
  }
  return result as Theme;
}

export interface ContrastResult {
  foreground: string;
  background: string;
  ratio: number;
  minimum: number;
  ok: boolean;
}

export function contrastResults(config: Config): ContrastResult[] {
  return contrastChecks(effectiveTheme(config)).map((check) => {
    const ratio = contrastRatio(check.foregroundColor, check.backgroundColor);
    return {
      foreground: check.foreground,
      background: check.background,
      ratio,
      minimum: check.minimum,
      ok: ratio >= check.minimum,
    };
  });
}

/** Field errors keyed by dotted path (`theme.accent`), in the interface language. */
export type FieldErrors = Record<string, string[]>;

const add = (errors: FieldErrors, path: string, message: string) => {
  const list = (errors[path] ??= []);
  if (!list.includes(message)) list.push(message);
};

/**
 * Validates the edited configuration with the gateway's own schema (the same rules the server
 * applies on publish), plus contrast errors on both colors of a failing pair.
 */
export function validate(tenant: string, config: Config, t: Dictionary): FieldErrors {
  const errors: FieldErrors = {};
  const result = tenantSchema.safeParse({
    ...config,
    // Server fields: managed by the platform, never edited here.
    schemaVersion: 1,
    id: tenant,
    difyBaseUrl: 'https://dify.invalid/v1',
    difyApiKeyEnv: 'SERVER_MANAGED',
  });
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.map(String).join('.');
      if (path.startsWith('theme.') && issue.code === 'custom') continue; // contrast, below
      add(errors, path || 'config', messageFor(issue, path, t));
    }
  }
  for (const check of contrastResults(config)) {
    if (check.ok) continue;
    const ratio = check.ratio.toFixed(2);
    add(
      errors,
      `theme.${check.foreground}`,
      t.errors.contrast(ratio, t.fields.color[check.background] ?? check.background, check.minimum),
    );
    add(
      errors,
      `theme.${check.background}`,
      t.errors.contrast(ratio, t.fields.color[check.foreground] ?? check.foreground, check.minimum),
    );
  }
  return errors;
}

interface Issue {
  code: string;
  message: string;
  minimum?: unknown;
  maximum?: unknown;
  input?: unknown;
}

function messageFor(issue: Issue, path: string, t: Dictionary): string {
  if (path === 'proactive.text') return t.errors.proactiveText;
  switch (issue.code) {
    case 'too_small':
      if (issue.input === '' || (Array.isArray(issue.input) && issue.input.length === 0)) {
        return t.errors.required;
      }
      return typeof issue.minimum === 'number'
        ? t.errors.tooSmall(issue.minimum)
        : t.errors.required;
    case 'too_big':
      return typeof issue.maximum === 'number' ? t.errors.tooBig(issue.maximum) : t.errors.format;
    case 'invalid_type':
      return t.errors.required;
    case 'invalid_format':
      if (path.startsWith('theme.')) return t.errors.color;
      if (path === 'behavior.privacyPolicyUrl') return t.errors.url;
      return t.errors.format;
    case 'custom':
      return path.startsWith('allowedOrigins') ? t.errors.origin : issue.message;
    default:
      return t.errors.format;
  }
}

/** Server messages are `path: message`; unknown paths go to the summary. */
export function serverErrors(messages: readonly string[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const message of messages) {
    const index = message.indexOf(': ');
    const path = index > 0 ? message.slice(0, index) : 'config';
    // Contrast and schema messages are already shown (localized) by the client validation.
    if (path.startsWith('theme.') || !/^[a-zA-Z.]+$/.test(path)) continue;
    add(errors, path, index > 0 ? message.slice(index + 2) : message);
  }
  return errors;
}

export function errorCount(errors: FieldErrors): number {
  return Object.values(errors).reduce((sum, list) => sum + list.length, 0);
}

/** Pending edits kept across a re-login (session storage: this tab only, cleared on save). */
export interface Stash {
  config: Config;
  baseVersion: number;
  draftRevision: number | null;
}

const stashKey = (tenant: string) => `admin:pending:${tenant}`;

export const stash = {
  save(tenant: string, value: Stash): void {
    try {
      sessionStorage.setItem(stashKey(tenant), JSON.stringify(value));
    } catch {
      // Storage unavailable: the edits stay in memory only.
    }
  },
  load(tenant: string): Stash | undefined {
    try {
      const raw = sessionStorage.getItem(stashKey(tenant));
      if (!raw) return undefined;
      const value = JSON.parse(raw) as Partial<Stash>;
      if (!isObject(value.config) || typeof value.baseVersion !== 'number') return undefined;
      return {
        config: value.config,
        baseVersion: value.baseVersion,
        draftRevision: typeof value.draftRevision === 'number' ? value.draftRevision : null,
      };
    } catch {
      return undefined;
    }
  },
  clear(tenant: string): void {
    try {
      sessionStorage.removeItem(stashKey(tenant));
    } catch {
      // ignore
    }
  },
};
