import { z } from 'zod';
import { TEXT_KEYS } from '../protocol/texts.js';
import { contrastRatio } from './contrast.js';

/**
 * Tenant configuration, schema version 1 (ADR 007). Single source of truth for the YAML files
 * today and for the E4b admin interface later. Contains no secrets. New fields are added as
 * optional ones with defaults, so existing version 1 files stay valid.
 */
export const SCHEMA_VERSION = 1;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb color');

/** A file in `config/tenants/<id>/assets/`. */
export const assetNameSchema = z
  .string()
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}\.(png|jpe?g|webp|svg)$/i,
    'must be a .png, .jpg, .webp or .svg file name',
  );

const originSchema = z.string().refine(
  (value) => {
    try {
      return new URL(value).origin === value;
    } catch {
      return false;
    }
  },
  { message: 'must be a bare origin, e.g. https://www.example.ro' },
);

const textValue = z.string().trim().min(1).max(2000);
/** Known keys only: an unknown key is an error (strict object). */
const textsSchema = z.strictObject(
  Object.fromEntries(TEXT_KEYS.map((key) => [key, textValue.optional()])) as Record<
    (typeof TEXT_KEYS)[number],
    z.ZodOptional<typeof textValue>
  >,
);

const localized = z.strictObject({ ro: textValue, en: textValue.optional() });

export const DEFAULT_THEME = {
  accent: '#3a36d0',
  accentEnd: '#1166c4',
  onAccent: '#ffffff',
  text: '#1b1f2a',
  textMuted: '#4f5868',
  background: '#ffffff',
  assistantBubble: '#f0f2f8',
  link: '#2c2aa8',
} as const;

const themeSchema = z.strictObject({
  /** Header gradient start, launcher; default for user bubbles and buttons. */
  accent: hexColor.default(DEFAULT_THEME.accent),
  /** Header gradient end (use the same value as `accent` for a flat color). */
  accentEnd: hexColor.default(DEFAULT_THEME.accentEnd),
  /** Text and icons on the accent colors. */
  onAccent: hexColor.default(DEFAULT_THEME.onAccent),
  text: hexColor.default(DEFAULT_THEME.text),
  textMuted: hexColor.default(DEFAULT_THEME.textMuted),
  background: hexColor.default(DEFAULT_THEME.background),
  assistantBubble: hexColor.default(DEFAULT_THEME.assistantBubble),
  link: hexColor.default(DEFAULT_THEME.link),
  /** Optional: user message bubbles (default: the accent gradient). */
  userBubble: hexColor.optional(),
  /** Optional: text on user bubbles (default: onAccent). */
  onUserBubble: hexColor.optional(),
  /** Optional: primary buttons, e.g. send (default: the accent gradient). */
  button: hexColor.optional(),
  /** Optional: text and icons on primary buttons (default: onAccent). */
  onButton: hexColor.optional(),
});
export type Theme = z.infer<typeof themeSchema>;

export interface ContrastCheck {
  foreground: keyof Theme;
  foregroundColor: string;
  background: keyof Theme;
  backgroundColor: string;
  minimum: number;
  usage: string;
}

/**
 * Every text/background pair the widget renders, with the effective colors (optional colors
 * fall back to the accent ones) and its WCAG 2.1 AA minimum.
 */
export function contrastChecks(theme: Theme): ContrastCheck[] {
  const pair = (
    foreground: keyof Theme,
    background: keyof Theme,
    minimum: number,
    usage: string,
  ): ContrastCheck => ({
    foreground,
    foregroundColor: theme[foreground] ?? '',
    background,
    backgroundColor: theme[background] ?? '',
    minimum,
    usage,
  });
  const userText: keyof Theme = theme.onUserBubble ? 'onUserBubble' : 'onAccent';
  const buttonText: keyof Theme = theme.onButton ? 'onButton' : 'onAccent';
  const checks: ContrastCheck[] = [
    pair('onAccent', 'accent', 4.5, 'header text'),
    pair('onAccent', 'accentEnd', 4.5, 'header text'),
    ...(theme.userBubble
      ? [pair(userText, 'userBubble', 4.5, 'user message text')]
      : [
          pair(userText, 'accent', 4.5, 'user message text'),
          pair(userText, 'accentEnd', 4.5, 'user message text'),
        ]),
    ...(theme.button
      ? [pair(buttonText, 'button', 4.5, 'primary button text and icons')]
      : [
          pair(buttonText, 'accent', 4.5, 'primary button text and icons'),
          pair(buttonText, 'accentEnd', 4.5, 'primary button text and icons'),
        ]),
    pair('text', 'background', 4.5, 'body text'),
    pair('text', 'assistantBubble', 4.5, 'assistant message text'),
    pair('textMuted', 'background', 4.5, 'hints and dates'),
    pair('textMuted', 'assistantBubble', 4.5, 'notes in answers'),
    pair('link', 'background', 4.5, 'links and text buttons'),
    pair('link', 'assistantBubble', 4.5, 'links in answers'),
    pair('accent', 'background', 3, 'launcher and controls (non-text)'),
  ];
  // With the defaults, user bubbles and buttons repeat the header pairs: report each pair once.
  const seen = new Set<string>();
  return checks.filter((check) => {
    const key = `${check.foreground}/${check.background}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Built-in launcher icons; the full set arrives with E4b. Unknown names are rejected. */
export const BUILTIN_ICONS = ['chat'] as const;

/** `{ type: 'builtin', name }` or `{ type: 'asset', file }`; a bare file name is the asset form. */
const launcherIconSchema = z.union([
  assetNameSchema.transform((file) => ({ type: 'asset' as const, file })),
  z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('builtin'), name: z.enum(BUILTIN_ICONS) }),
    z.strictObject({ type: z.literal('asset'), file: assetNameSchema }),
  ]),
]);
export type LauncherIcon = z.infer<typeof launcherIconSchema>;

export const PRESENTATION_SECTIONS = [
  'identity',
  'launcher',
  'window',
  'theme',
  'texts',
  'proactive',
  'citations',
] as const;

export const tenantSchema = z
  .strictObject({
    schemaVersion: z.literal(SCHEMA_VERSION, {
      message: `schemaVersion must be ${String(SCHEMA_VERSION)}`,
    }),
    id: z.string().regex(/^[a-z0-9-]{1,64}$/, 'id must be lowercase letters, digits or dashes'),
    name: z.string().min(1).max(200),
    /** A disabled tenant shows no launcher; its API answers `tenant_disabled` (E4b §5.6). */
    enabled: z.boolean().default(true),
    difyBaseUrl: z.url({ protocol: /^https?$/ }).transform((url) => url.replace(/\/+$/, '')),
    difyApiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    allowedOrigins: z.array(originSchema).min(1),

    identity: z
      .strictObject({
        /** Shown in the header; defaults to `name`. */
        assistantName: z.string().trim().min(1).max(80).optional(),
        logo: assetNameSchema.optional(),
        assistantAvatar: assetNameSchema.optional(),
        /** An image, or `none` (default) for no user avatar. */
        userAvatar: z.union([assetNameSchema, z.literal('none')]).default('none'),
      })
      .default({ userAvatar: 'none' }),
    launcher: z
      .strictObject({
        icon: launcherIconSchema.optional(),
        position: z.enum(['bottom-right', 'bottom-left']).default('bottom-right'),
        offsetX: z.number().int().min(0).max(200).default(24),
        offsetY: z.number().int().min(0).max(200).default(24),
      })
      .default({ position: 'bottom-right', offsetX: 24, offsetY: 24 }),
    window: z
      .strictObject({
        width: z.number().int().min(320).max(520).default(380),
        height: z.number().int().min(420).max(800).default(640),
        /** Separate from the launcher; `auto` opens on the launcher's side. */
        position: z.enum(['auto', 'bottom-right', 'bottom-left']).default('auto'),
      })
      .default({ width: 380, height: 640, position: 'auto' }),
    theme: themeSchema.default(DEFAULT_THEME),
    texts: z.strictObject({ ro: textsSchema.optional(), en: textsSchema.optional() }).default({}),
    proactive: z
      .strictObject({
        enabled: z.boolean().default(false),
        text: localized.optional(),
        delaySeconds: z.number().int().min(1).max(600).default(15),
        /** `day` is reserved for a later stage (E4b admin exposes both). */
        frequency: z.enum(['session', 'day']).default('session'),
        showOnMobile: z.boolean().default(false),
      })
      .default({ enabled: false, delaySeconds: 15, frequency: 'session', showOnMobile: false }),
    citations: z
      .strictObject({
        documentTitles: z
          .record(z.string().min(1).max(300), z.string().min(1).max(300))
          .default({}),
        showSnippets: z.boolean().default(false),
      })
      .default({ documentTitles: {}, showSnippets: false }),
    behavior: z
      .strictObject({
        /** Dify generates them with an extra model call per answer (SPEC §6): off by default. */
        suggestionsAfterAnswer: z.boolean().default(false),
        visitorCookieDays: z.number().int().min(1).max(395).default(30),
        /** Linked from the GDPR notice (E7). */
        privacyPolicyUrl: z.url({ protocol: /^https$/ }).optional(),
      })
      .default({ suggestionsAfterAnswer: false, visitorCookieDays: 30 }),
    feedback: z
      .strictObject({ retentionDays: z.number().int().min(1).max(730).default(90) })
      .default({ retentionDays: 90 }),
  })
  .superRefine((tenant, context) => {
    for (const check of contrastChecks(tenant.theme)) {
      const ratio = contrastRatio(check.foregroundColor, check.backgroundColor);
      if (ratio < check.minimum) {
        context.addIssue({
          code: 'custom',
          path: ['theme', check.foreground],
          message: `contrast ${ratio.toFixed(2)}:1 between ${check.foreground} ${check.foregroundColor} and ${check.background} ${check.backgroundColor} (${check.usage}) is below ${String(check.minimum)}:1`,
        });
      }
    }
    if (tenant.proactive.enabled && !tenant.proactive.text) {
      context.addIssue({
        code: 'custom',
        path: ['proactive', 'text'],
        message: 'is required when the proactive message is enabled',
      });
    }
    if (tenant.proactive.frequency === 'day') {
      context.addIssue({
        code: 'custom',
        path: ['proactive', 'frequency'],
        message: '"day" is not implemented yet; use "session"',
      });
    }
  });

export type TenantConfig = z.infer<typeof tenantSchema>;
