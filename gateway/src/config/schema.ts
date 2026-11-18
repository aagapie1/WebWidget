import { z } from 'zod';
import { TEXT_KEYS } from '../protocol/texts.js';
import { contrastRatio } from './contrast.js';

/**
 * Tenant configuration, schema version 1 (ADR 007). Single source of truth for the YAML files
 * today and for the E4b admin interface later. Contains no secrets.
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
  /** Header gradient start, user bubbles, launcher, primary buttons. */
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
});
export type Theme = z.infer<typeof themeSchema>;

/** Every text/background pair the widget renders, with its WCAG 2.1 AA minimum. */
export const CONTRAST_PAIRS: readonly {
  foreground: keyof Theme;
  background: keyof Theme;
  minimum: number;
  usage: string;
}[] = [
  {
    foreground: 'onAccent',
    background: 'accent',
    minimum: 4.5,
    usage: 'header and user message text',
  },
  {
    foreground: 'onAccent',
    background: 'accentEnd',
    minimum: 4.5,
    usage: 'header and user message text',
  },
  { foreground: 'text', background: 'background', minimum: 4.5, usage: 'body text' },
  {
    foreground: 'text',
    background: 'assistantBubble',
    minimum: 4.5,
    usage: 'assistant message text',
  },
  { foreground: 'textMuted', background: 'background', minimum: 4.5, usage: 'hints and dates' },
  {
    foreground: 'textMuted',
    background: 'assistantBubble',
    minimum: 4.5,
    usage: 'notes in answers',
  },
  { foreground: 'link', background: 'background', minimum: 4.5, usage: 'links and text buttons' },
  { foreground: 'link', background: 'assistantBubble', minimum: 4.5, usage: 'links in answers' },
  {
    foreground: 'accent',
    background: 'background',
    minimum: 3,
    usage: 'launcher and controls (non-text)',
  },
];

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
      message: `schemaVersion must be ${SCHEMA_VERSION}`,
    }),
    id: z.string().regex(/^[a-z0-9-]{1,64}$/, 'id must be lowercase letters, digits or dashes'),
    name: z.string().min(1).max(200),
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
        icon: assetNameSchema.optional(),
        position: z.enum(['bottom-right', 'bottom-left']).default('bottom-right'),
        offsetX: z.number().int().min(0).max(200).default(24),
        offsetY: z.number().int().min(0).max(200).default(24),
      })
      .default({ position: 'bottom-right', offsetX: 24, offsetY: 24 }),
    window: z
      .strictObject({
        width: z.number().int().min(320).max(520).default(380),
        height: z.number().int().min(420).max(800).default(640),
      })
      .default({ width: 380, height: 640 }),
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
    for (const pair of CONTRAST_PAIRS) {
      const ratio = contrastRatio(tenant.theme[pair.foreground], tenant.theme[pair.background]);
      if (ratio < pair.minimum) {
        context.addIssue({
          code: 'custom',
          path: ['theme', pair.foreground],
          message: `contrast ${ratio.toFixed(2)}:1 between ${pair.foreground} ${tenant.theme[pair.foreground]} and ${pair.background} ${tenant.theme[pair.background]} (${pair.usage}) is below ${String(pair.minimum)}:1`,
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
