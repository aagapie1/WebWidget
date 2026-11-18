import { z } from 'zod';
import {
  ASSISTANT_AVATAR_ICON_NAMES,
  LAUNCHER_ICON_NAMES,
  USER_AVATAR_ICON_NAMES,
} from '../protocol/icons.js';
import { TEXT_KEYS } from '../protocol/texts.js';
import { contrastRatio, readableOn, textOn } from './contrast.js';

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

export const ORIGIN_MESSAGE = 'must be a bare origin, e.g. https://www.example.ro';
export const ORIGIN_HTTPS_MESSAGE = 'must use https (http only for localhost)';
/** http is allowed only for local development (E4b.1 UX 14). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const originSchema = z
  .string()
  .refine(
    (value) => {
      try {
        return new URL(value).origin === value;
      } catch {
        return false;
      }
    },
    { message: ORIGIN_MESSAGE, abort: true },
  )
  .refine(
    (value) => {
      const url = new URL(value);
      return url.protocol === 'https:' || LOCAL_HOSTS.has(url.hostname);
    },
    { message: ORIGIN_HTTPS_MESSAGE },
  );

const textValue = z.string().trim().min(1).max(2000);
/** Known keys only: an unknown key is an error (strict object). */
const textsSchema = z.strictObject({
  ...(Object.fromEntries(TEXT_KEYS.map((key) => [key, textValue.optional()])) as Record<
    (typeof TEXT_KEYS)[number],
    z.ZodOptional<typeof textValue>
  >),
  /** Starter questions for this language (E4b.1 UX); empty: the assistant's own (Dify). */
  suggestedQuestions: z.array(z.string().trim().min(1).max(200)).max(5).optional(),
});

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

const themeInputSchema = z.strictObject({
  /** Header gradient start, launcher; default for user bubbles and buttons. */
  accent: hexColor.optional(),
  /** Header gradient end. Unset: the accent (a flat header), or the default pair. */
  accentEnd: hexColor.optional(),
  /** Text and icons on the accent colors. Unset: white or black, whichever contrasts more. */
  onAccent: hexColor.optional(),
  text: hexColor.optional(),
  textMuted: hexColor.optional(),
  background: hexColor.optional(),
  assistantBubble: hexColor.optional(),
  /** Unset: the accent, darkened until it reaches 4.5:1 (or the default link color). */
  link: hexColor.optional(),
  /** Optional: user message bubbles (default: the accent gradient). */
  userBubble: hexColor.optional(),
  /** Optional: text on user bubbles (default: onAccent). */
  onUserBubble: hexColor.optional(),
  /** Optional: primary buttons, e.g. send (default: the accent gradient). */
  button: hexColor.optional(),
  /** Optional: text and icons on primary buttons (default: onAccent). */
  onButton: hexColor.optional(),
});
export type ThemeInput = z.infer<typeof themeInputSchema>;

export interface Theme {
  accent: string;
  accentEnd: string;
  onAccent: string;
  text: string;
  textMuted: string;
  background: string;
  assistantBubble: string;
  link: string;
  userBubble?: string | undefined;
  onUserBubble?: string | undefined;
  button?: string | undefined;
  onButton?: string | undefined;
}

/**
 * The colors the widget uses (E4b.1 UX 9, option A): the values set, and for the others the
 * defaults or colors derived from the accent. The same code runs in the gateway and in the admin
 * preview, so "automatic" values match what visitors see.
 */
export function resolveTheme(input: ThemeInput): Theme {
  const accent = input.accent ?? DEFAULT_THEME.accent;
  const background = input.background ?? DEFAULT_THEME.background;
  const assistantBubble = input.assistantBubble ?? DEFAULT_THEME.assistantBubble;
  const accentEnd = input.accentEnd ?? (input.accent ? accent : DEFAULT_THEME.accentEnd);
  return {
    accent,
    accentEnd,
    onAccent: input.onAccent ?? textOn([accent, accentEnd]),
    text: input.text ?? DEFAULT_THEME.text,
    textMuted: input.textMuted ?? DEFAULT_THEME.textMuted,
    background,
    assistantBubble,
    link:
      input.link ??
      (input.accent ? readableOn(accent, [background, assistantBubble]) : DEFAULT_THEME.link),
    ...(input.userBubble ? { userBubble: input.userBubble } : {}),
    ...(input.onUserBubble ? { onUserBubble: input.onUserBubble } : {}),
    ...(input.button ? { button: input.button } : {}),
    ...(input.onButton ? { onButton: input.onButton } : {}),
  };
}

const themeSchema = themeInputSchema.transform(resolveTheme);

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

/** Built-in launcher icons (Lucide, bundled in the widget). Unknown names are rejected. */
export const BUILTIN_ICONS = LAUNCHER_ICON_NAMES;

/** `{ type: 'builtin', name }` or `{ type: 'asset', file }`; a bare file name is the asset form. */
const launcherIconSchema = z.union([
  assetNameSchema.transform((file) => ({ type: 'asset' as const, file })),
  z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('builtin'), name: z.enum(BUILTIN_ICONS) }),
    z.strictObject({ type: z.literal('asset'), file: assetNameSchema }),
  ]),
]);
export type LauncherIcon = z.infer<typeof launcherIconSchema>;

const assetAvatar = z.strictObject({ type: z.literal('asset'), file: assetNameSchema });
const initialsAvatar = z.strictObject({ type: z.literal('initials') });
const noAvatar = z.strictObject({ type: z.literal('none') });

/**
 * Assistant avatar (E4b.1 UX): initials of the assistant name on the accent color (default when
 * absent), a generic icon, an uploaded image or none. A bare file name is the image form.
 */
const assistantAvatarSchema = z.union([
  assetNameSchema.transform((file) => ({ type: 'asset' as const, file })),
  z.discriminatedUnion('type', [
    assetAvatar,
    initialsAvatar,
    noAvatar,
    z.strictObject({ type: z.literal('builtin'), name: z.enum(ASSISTANT_AVATAR_ICON_NAMES) }),
  ]),
]);
export type AssistantAvatar = z.infer<typeof assistantAvatarSchema>;

/** Visitor avatar: none (default), "Tu"/"You", a generic silhouette or an uploaded image. */
const userAvatarSchema = z.union([
  z.literal('none').transform(() => ({ type: 'none' as const })),
  assetNameSchema.transform((file) => ({ type: 'asset' as const, file })),
  z.discriminatedUnion('type', [
    assetAvatar,
    initialsAvatar,
    noAvatar,
    z.strictObject({ type: z.literal('builtin'), name: z.enum(USER_AVATAR_ICON_NAMES) }),
  ]),
]);
export type UserAvatar = z.infer<typeof userAvatarSchema>;

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
        /** Default when absent: the initials of the assistant name. */
        assistantAvatar: assistantAvatarSchema.optional(),
        userAvatar: userAvatarSchema.default({ type: 'none' }),
      })
      .default({ userAvatar: { type: 'none' } }),
    launcher: z
      .strictObject({
        icon: launcherIconSchema.optional(),
        /** The launcher's own color (flat). Unset: the accent gradient. Its icon is automatic. */
        color: hexColor.optional(),
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
    theme: themeSchema.default(resolveTheme({})),
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
    // The launcher sits on the client's page: 3:1 against white (WCAG 1.4.11).
    if (tenant.launcher.color && contrastRatio(tenant.launcher.color, '#ffffff') < 3) {
      context.addIssue({
        code: 'custom',
        path: ['launcher', 'color'],
        message: `contrast ${contrastRatio(tenant.launcher.color, '#ffffff').toFixed(2)}:1 between the launcher ${tenant.launcher.color} and a white page is below 3:1`,
      });
    }
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
