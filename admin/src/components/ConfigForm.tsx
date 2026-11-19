import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { resolveTheme, type Theme } from 'gateway/config-schema';
import { ERROR_TEXTS, TEXT_KEYS } from 'gateway/texts';
import { texts as widgetTexts } from 'widget/i18n';
import type { Config, ConfigState } from '../api.js';
import { useI18n } from '../i18n.js';
import { getIn, themeInput, type FieldErrors, type Path } from '../model.js';
import { ColorField } from './ColorField.js';
import { NumberField, SelectField, TextField } from './Field.js';
import { ImageField } from './ImageField.js';
import { IntegrationSection } from './IntegrationSection.js';
import { LocaleTabs } from './LocaleTabs.js';
import { NodeIcon, OptionGrid, type GridOption } from './OptionGrid.js';
import { OriginsList } from './OriginsList.js';
import { QuestionsEditor } from './QuestionsEditor.js';
import { SwitchRow } from './SwitchRow.js';
import {
  AppWindow,
  Lightbulb,
  MessageCircleMore,
  Smartphone,
  TextQuote,
  Upload,
} from '../icons.js';
import { AVATAR_ICONS, LAUNCHER_ICONS } from 'widget/icons';
import type { Installation } from '../api.js';
import { initials } from '../model.js';

export interface ConfigFormProps {
  tenant: string;
  config: Config;
  errors: FieldErrors;
  permissions: ConfigState['permissions'];
  onChange: (path: Path, value: unknown) => void;
  upload: (file: File) => Promise<{ file: string }>;
  /** Colors in effect (for the icon and avatar tiles). */
  accent: string;
  onAccent: string;
  /** The assistant's own starter questions (Dify), suggested when a language has none. */
  assistantQuestions: readonly string[];
  /** File names the assistant cited recently (suggestions for the title mapping). */
  citedDocuments?: readonly string[];
  /** The area shown (one at a time, chosen in the sidebar). */
  area?: Area;
  /** "Integrare pe site"; omitted when the gateway address is unknown. */
  integration?:
    | {
        gatewayOrigin: string;
        origins: readonly string[];
        checkInstallations: () => Promise<{ installations: Installation[] }>;
        domainsStatus?: 'ok' | 'missing' | 'invalid';
        onDomains?: () => void;
      }
    | undefined;
}

export type Area =
  'aspect' | 'texts' | 'proactive' | 'citations' | 'behavior' | 'domains' | 'integration';

type LauncherChoice = keyof typeof LAUNCHER_ICONS | 'image';
type AssistantAvatarChoice =
  'initials' | 'bot' | 'sparkles' | 'landmark' | 'headset' | 'image' | 'none';
type UserAvatarChoice = 'none' | 'initials' | 'person' | 'image';

/** Stored avatar/icon setting → its type and details (old forms: a bare file name is an image). */
function setting(value: unknown): { type?: string; name?: string; file?: string } {
  if (typeof value === 'string')
    return value === 'none' ? { type: 'none' } : { type: 'asset', file: value };
  if (value !== null && typeof value === 'object') return value;
  return {};
}

/** Shown at once: the main color and the header's second color. */
const MAIN_COLORS = ['accent', 'accentEnd'] as const;
/** Folded under "Culori avansate". */
const ADVANCED_COLORS = [
  'onAccent',
  'link',
  'text',
  'textMuted',
  'background',
  'assistantBubble',
  'userBubble',
  'onUserBubble',
  'button',
  'onButton',
] as const;
/** Computed from other colors when unset (resolveTheme in the gateway). */
const AUTOMATIC_COLORS = new Set([
  'accentEnd',
  'onAccent',
  'link',
  'userBubble',
  'onUserBubble',
  'button',
  'onButton',
]);
/** Optional colors fall back to these when unset (gateway contrastChecks rules). */
const COLOR_FALLBACK: Record<string, keyof Theme> = {
  userBubble: 'accent',
  onUserBubble: 'onAccent',
  button: 'accent',
  onButton: 'onAccent',
};

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ComponentChildren;
}) {
  return (
    <section class="card" aria-labelledby={`section-${id}`}>
      <h2 id={`section-${id}`}>{title}</h2>
      {children}
    </section>
  );
}

/** One origin per line; the text is kept as typed, the list is what gets saved. */
/** The editable configuration (spec §5.1), grouped in sections. */
export function ConfigForm({
  tenant,
  config,
  errors,
  permissions,
  onChange,
  upload,
  assistantQuestions,
  citedDocuments = [],
  integration,
  area = 'aspect',
}: ConfigFormProps) {
  const { t } = useI18n();
  // "Imagine încărcată" chosen but nothing uploaded yet: show the upload field.
  const [imageChoice, setImageChoice] = useState<Record<string, boolean>>({});
  const chooseImage = (key: string, on: boolean) => {
    setImageChoice((current) => ({ ...current, [key]: on }));
  };
  const swatch = (content: preact.ComponentChildren) => <span class="glyph">{content}</span>;
  const value = (path: string) => getIn(config, path.split('.'));
  const errorsFor = (path: string) => errors[path];
  const textErrors = {
    ro: Object.keys(errors).filter((path) => path.startsWith('texts.ro.')).length,
    en: Object.keys(errors).filter((path) => path.startsWith('texts.en.')).length,
  };
  const set = (path: string) => (next: unknown) => {
    onChange(path.split('.'), next);
  };
  // The uploaded image appears once, in the row under the grid; the tile only says "Imagine".
  const thumb = () => swatch(<NodeIcon node={Upload} size={18} />);

  // Launcher icon: built-in set or an uploaded image (`chat` is the default).
  const icon = setting(value('launcher.icon'));
  const iconFile = icon.type === 'asset' ? icon.file : undefined;
  const iconChoice: LauncherChoice =
    iconFile || imageChoice.launcher
      ? 'image'
      : icon.type === 'builtin' && icon.name && icon.name in LAUNCHER_ICONS
        ? (icon.name as LauncherChoice)
        : 'chat';
  const launcherOptions: GridOption<LauncherChoice>[] = [
    ...(Object.keys(LAUNCHER_ICONS) as (keyof typeof LAUNCHER_ICONS)[]).map((name) => ({
      value: name,
      label: t.ux.launcherIcons[name] ?? name,
      visual: swatch(<NodeIcon node={LAUNCHER_ICONS[name]} />),
    })),
    { value: 'image', label: t.ux.avatarOptions.image ?? '', visual: thumb() },
  ];

  // Assistant avatar: initials by default.
  const assistantName = str(value('identity.assistantName')) ?? str(value('name')) ?? '';
  const assistantAvatar = setting(value('identity.assistantAvatar'));
  const assistantFile = assistantAvatar.type === 'asset' ? assistantAvatar.file : undefined;
  const assistantChoice: AssistantAvatarChoice =
    assistantFile || imageChoice.assistant
      ? 'image'
      : assistantAvatar.type === 'builtin'
        ? (assistantAvatar.name as AssistantAvatarChoice)
        : assistantAvatar.type === 'none'
          ? 'none'
          : 'initials';
  const assistantOptions: GridOption<AssistantAvatarChoice>[] = [
    {
      value: 'initials',
      label: t.ux.avatarOptions.initials ?? '',
      visual: swatch(<b>{initials(assistantName)}</b>),
    },
    ...(['bot', 'sparkles', 'landmark', 'headset'] as const).map((name) => ({
      value: name,
      label: t.ux.avatarOptions[name] ?? name,
      visual: swatch(<NodeIcon node={AVATAR_ICONS[name]} />),
    })),
    { value: 'image', label: t.ux.avatarOptions.image ?? '', visual: thumb() },
    {
      value: 'none',
      label: t.ux.avatarOptions.none ?? '',
      visual: <span class="tile__none">∅</span>,
    },
  ];

  // Visitor avatar: none by default.
  const userAvatar = setting(value('identity.userAvatar'));
  const userFile = userAvatar.type === 'asset' ? userAvatar.file : undefined;
  const userChoice: UserAvatarChoice =
    userFile || imageChoice.user
      ? 'image'
      : userAvatar.type === 'initials'
        ? 'initials'
        : userAvatar.type === 'builtin'
          ? 'person'
          : 'none';
  const userOptions: GridOption<UserAvatarChoice>[] = [
    {
      value: 'none',
      label: t.ux.userAvatarOptions.none ?? '',
      visual: <span class="tile__none">∅</span>,
    },
    {
      value: 'initials',
      label: t.ux.userAvatarOptions.initials ?? '',
      visual: swatch(<b>{t.ux.youInitials}</b>),
    },
    {
      value: 'person',
      label: t.ux.userAvatarOptions.person ?? '',
      visual: swatch(<NodeIcon node={AVATAR_ICONS.person} />),
    },
    { value: 'image', label: t.ux.userAvatarOptions.image ?? '', visual: thumb() },
  ];
  const proactiveOn = value('proactive.enabled') === true;
  const theme = (key: string) => str(value(`theme.${key}`));
  // What a color would be without its own value: the gateway's default or automatic color.
  const colorsSet = themeInput(config);
  const fallbackColor = (key: string): string => {
    const resolved = resolveTheme({ ...colorsSet, [key]: undefined });
    const base = COLOR_FALLBACK[key];
    return resolved[key as keyof Theme] ?? (base ? resolved[base] : undefined) ?? '';
  };
  const colorField = (key: string) => (
    <ColorField
      key={key}
      label={t.fields.color[key] ?? key}
      value={theme(key)}
      fallback={fallbackColor(key)}
      automatic={AUTOMATIC_COLORS.has(key)}
      onChange={set(`theme.${key}`)}
      errors={errorsFor(`theme.${key}`)}
    />
  );
  const advancedErrors = ADVANCED_COLORS.some((key) => errorsFor(`theme.${key}`));
  const origins = Array.isArray(value('allowedOrigins'))
    ? (value('allowedOrigins') as string[])
    : [];
  const titles = (value('citations.documentTitles') ?? {}) as Record<string, string>;
  const titleRows = Object.entries(titles);
  const citedListId = 'cited-documents';

  return (
    <div class="form">
      {area === 'aspect' && (
        <Section id="identity" title={t.sections.identity ?? ''}>
          <div class="row">
            <TextField
              label={t.fields.name}
              value={str(value('name'))}
              readOnly={!permissions.name}
              hint={permissions.name ? undefined : t.fields.nameReadOnly}
              onChange={set('name')}
              errors={errorsFor('name')}
            />
            <TextField
              label={t.fields.assistantName}
              hint={t.fields.assistantNameHint}
              value={str(value('identity.assistantName'))}
              onChange={set('identity.assistantName')}
              errors={errorsFor('identity.assistantName')}
            />
          </div>
          <ImageField
            label={t.fields.logo}
            where={t.ux.imageWhere.logo}
            tenant={tenant}
            value={str(value('identity.logo'))}
            canUpload={permissions.assets}
            upload={upload}
            onChange={set('identity.logo')}
            errors={errorsFor('identity.logo')}
          />
          <OptionGrid
            legend={t.fields.assistantAvatar}
            hint={t.ux.imageWhere.assistant}
            value={assistantChoice}
            options={assistantOptions}
            onChange={(choice) => {
              chooseImage('assistant', choice === 'image');
              if (choice === 'image') return;
              onChange(
                ['identity', 'assistantAvatar'],
                choice === 'initials'
                  ? undefined
                  : choice === 'none'
                    ? { type: 'none' }
                    : { type: 'builtin', name: choice },
              );
            }}
          />
          {assistantChoice === 'image' && (
            <ImageField
              label={t.fields.assistantAvatar}
              hideLabel
              hideEmptyPreview
              tenant={tenant}
              value={assistantFile}
              canUpload={permissions.assets}
              upload={upload}
              onChange={(file) => {
                onChange(
                  ['identity', 'assistantAvatar'],
                  file ? { type: 'asset', file } : undefined,
                );
                if (!file) chooseImage('assistant', false);
              }}
              errors={errorsFor('identity.assistantAvatar')}
            />
          )}
          <OptionGrid
            legend={t.fields.userAvatar}
            hint={t.ux.imageWhere.user}
            value={userChoice}
            options={userOptions}
            onChange={(choice) => {
              chooseImage('user', choice === 'image');
              if (choice === 'image') return;
              onChange(
                ['identity', 'userAvatar'],
                choice === 'none'
                  ? undefined
                  : choice === 'initials'
                    ? { type: 'initials' }
                    : { type: 'builtin', name: 'person' },
              );
            }}
          />
          {userChoice === 'image' && (
            <ImageField
              label={t.fields.userAvatar}
              hideLabel
              hideEmptyPreview
              tenant={tenant}
              value={userFile}
              canUpload={permissions.assets}
              upload={upload}
              onChange={(file) => {
                onChange(['identity', 'userAvatar'], file ? { type: 'asset', file } : undefined);
                if (!file) chooseImage('user', false);
              }}
              errors={errorsFor('identity.userAvatar')}
            />
          )}
        </Section>
      )}
      {area === 'aspect' && (
        <Section id="launcher" title={t.sections.launcher ?? ''}>
          <OptionGrid
            legend={t.fields.icon}
            hint={t.ux.imageWhere.launcher}
            value={iconChoice}
            options={launcherOptions}
            onChange={(choice) => {
              chooseImage('launcher', choice === 'image');
              if (choice === 'image') return;
              onChange(
                ['launcher', 'icon'],
                choice === 'chat' ? undefined : { type: 'builtin', name: choice },
              );
            }}
          />
          {iconChoice === 'image' && (
            <ImageField
              label={t.fields.iconImage}
              hideLabel
              hideEmptyPreview
              tenant={tenant}
              value={iconFile}
              canUpload={permissions.assets}
              upload={upload}
              onChange={(file) => {
                onChange(['launcher', 'icon'], file ? { type: 'asset', file } : undefined);
                if (!file) chooseImage('launcher', false);
              }}
              errors={errorsFor('launcher.icon')}
            />
          )}
          {/* The launcher's own color (E4b.1 UX 10): automatic = the main color's gradient. */}
          <ColorField
            label={t.fields.launcherColor}
            value={str(value('launcher.color'))}
            fallback={resolveTheme(colorsSet).accent}
            automatic
            onChange={set('launcher.color')}
            errors={errorsFor('launcher.color')}
          />
          <p class="field__hint">{t.fields.launcherColorHint}</p>
          <SelectField
            label={t.fields.position}
            value={str(value('launcher.position')) ?? 'bottom-right'}
            options={[
              { value: 'bottom-right', label: t.fields.bottomRight },
              { value: 'bottom-left', label: t.fields.bottomLeft },
            ]}
            onChange={set('launcher.position')}
          />
          <div class="row">
            <NumberField
              label={t.fields.offsetX}
              value={num(value('launcher.offsetX'))}
              defaultValue={24}
              min={0}
              max={200}
              onChange={set('launcher.offsetX')}
              errors={errorsFor('launcher.offsetX')}
            />
            <NumberField
              label={t.fields.offsetY}
              value={num(value('launcher.offsetY'))}
              defaultValue={24}
              min={0}
              max={200}
              onChange={set('launcher.offsetY')}
              errors={errorsFor('launcher.offsetY')}
            />
          </div>
        </Section>
      )}
      {area === 'aspect' && (
        <Section id="window" title={t.ux.subsections.window ?? ''}>
          <div class="row">
            <NumberField
              label={t.fields.width}
              value={num(value('window.width'))}
              defaultValue={380}
              min={320}
              max={520}
              onChange={set('window.width')}
              errors={errorsFor('window.width')}
            />
            <NumberField
              label={t.fields.height}
              value={num(value('window.height'))}
              defaultValue={640}
              min={420}
              max={800}
              onChange={set('window.height')}
              errors={errorsFor('window.height')}
            />
          </div>
          <SwitchRow
            icon={AppWindow}
            title={t.ux.sameSide}
            description={t.ux.sameSideHint}
            checked={(str(value('window.position')) ?? 'auto') === 'auto'}
            onChange={(on) => {
              onChange(
                ['window', 'position'],
                on ? undefined : (str(value('launcher.position')) ?? 'bottom-right'),
              );
            }}
          />
          {(str(value('window.position')) ?? 'auto') !== 'auto' && (
            <SelectField
              label={t.fields.windowPosition}
              value={str(value('window.position')) ?? 'bottom-right'}
              options={[
                { value: 'bottom-right', label: t.fields.bottomRight },
                { value: 'bottom-left', label: t.fields.bottomLeft },
              ]}
              onChange={set('window.position')}
            />
          )}
        </Section>
      )}

      {area === 'aspect' && (
        <Section id="colors" title={t.fields.colors}>
          <p class="field__hint">{t.fields.colorsIntro}</p>
          <div class="grid">{MAIN_COLORS.map(colorField)}</div>
          {/* Open by itself when one of its colors has an error (the status bar links to it). */}
          <details class="advanced" open={advancedErrors || undefined}>
            <summary>{t.fields.advancedColors}</summary>
            <div class="grid">{ADVANCED_COLORS.map(colorField)}</div>
          </details>
        </Section>
      )}
      {area === 'texts' && (
        <Section id="texts" title={t.sections.texts ?? ''}>
          <LocaleTabs label={t.ux.textsLanguage} errors={textErrors}>
            {(locale) => {
              const defaults = widgetTexts(locale) as unknown as Record<string, unknown>;
              /** The text used now when the field is empty (widget or gateway default). */
              const defaultOf = (key: string): string => {
                const widget = getIn(defaults, key.split('.'));
                if (typeof widget === 'string') return widget;
                const code = key.startsWith('errors.') ? key.slice('errors.'.length) : '';
                return (ERROR_TEXTS[locale] as Record<string, string | undefined>)[code] ?? key;
              };
              const current = (key: string) =>
                str(value(`texts.${locale}`) && getIn(value(`texts.${locale}`), [key]));
              const field = (key: string, label: string, hint?: string, placeholder?: string) => (
                <TextField
                  key={key}
                  label={label}
                  hint={hint}
                  value={current(key)}
                  placeholder={placeholder}
                  onChange={(next) => {
                    onChange(['texts', locale, key], next);
                  }}
                  errors={errorsFor(`texts.${locale}.${key}`)}
                />
              );
              const others = TEXT_KEYS.filter(
                (key) => key !== 'welcome' && key !== 'composer.placeholder',
              );
              const groups = new Map<string, string[]>();
              for (const key of others) {
                const prefix = key.split('.')[0] ?? key;
                const group = t.ux.textGroups[prefix] ? prefix : 'launcher';
                groups.set(group, [...(groups.get(group) ?? []), key]);
              }
              return (
                <>
                  {field('welcome', t.fields.welcome, t.fields.welcomeHint)}
                  {field(
                    'composer.placeholder',
                    t.fields.placeholder,
                    t.ux.defaultIs(defaultOf('composer.placeholder')),
                  )}
                  <QuestionsEditor
                    questions={
                      Array.isArray(getIn(value('texts'), [locale, 'suggestedQuestions']))
                        ? (getIn(value('texts'), [locale, 'suggestedQuestions']) as string[])
                        : undefined
                    }
                    assistantQuestions={assistantQuestions}
                    errors={errors}
                    errorPath={`texts.${locale}.suggestedQuestions`}
                    onChange={(next) => {
                      onChange(['texts', locale, 'suggestedQuestions'], next);
                    }}
                  />
                  <details>
                    <summary>{t.fields.moreTexts}</summary>
                    <p class="field__hint">{t.ux.otherTextsHint}</p>
                    {[...groups].map(([group, keys]) => (
                      <fieldset key={group} class="text-group">
                        <legend>{t.ux.textGroups[group]}</legend>
                        {keys.map((key) => field(key, `„${defaultOf(key)}”`))}
                      </fieldset>
                    ))}
                  </details>
                </>
              );
            }}
          </LocaleTabs>
        </Section>
      )}
      {area === 'proactive' && (
        <Section id="proactive" title={t.sections.proactive ?? ''}>
          <SwitchRow
            icon={MessageCircleMore}
            title={t.fields.proactiveEnabled}
            description={t.ux.proactiveDescription}
            checked={proactiveOn}
            onChange={set('proactive.enabled')}
          >
            <>
              <TextField
                label={t.fields.proactiveTextRo}
                multiline
                value={str(value('proactive.text.ro'))}
                onChange={set('proactive.text.ro')}
                errors={errorsFor('proactive.text') ?? errorsFor('proactive.text.ro')}
              />
              <TextField
                label={t.fields.proactiveTextEn}
                multiline
                value={str(value('proactive.text.en'))}
                onChange={set('proactive.text.en')}
                errors={errorsFor('proactive.text.en')}
              />
              <div class="row">
                <NumberField
                  label={t.fields.delaySeconds}
                  value={num(value('proactive.delaySeconds'))}
                  defaultValue={15}
                  min={1}
                  max={600}
                  onChange={set('proactive.delaySeconds')}
                  errors={errorsFor('proactive.delaySeconds')}
                />
                <SelectField
                  label={t.fields.frequency}
                  value={str(value('proactive.frequency')) ?? 'session'}
                  options={[
                    { value: 'session', label: t.fields.perSession },
                    { value: 'day', label: t.fields.perDay, disabled: true },
                  ]}
                  onChange={set('proactive.frequency')}
                  errors={errorsFor('proactive.frequency')}
                />
              </div>
              <SwitchRow
                icon={Smartphone}
                title={t.fields.showOnMobile}
                description={t.ux.showOnMobileDescription}
                checked={value('proactive.showOnMobile') === true}
                onChange={set('proactive.showOnMobile')}
              />
            </>
          </SwitchRow>
        </Section>
      )}
      {area === 'citations' && (
        <Section id="citations" title={t.sections.citations ?? ''}>
          <fieldset class="field">
            <legend>{t.fields.documentTitles}</legend>
            {citedDocuments.length > 0 && (
              <datalist id={citedListId}>
                {citedDocuments
                  .filter((name) => !(name in titles))
                  .map((name) => (
                    <option key={name} value={name} />
                  ))}
              </datalist>
            )}
            {titleRows.map(([file, title], index) => (
              <div class="row row--titles" key={index}>
                <TextField
                  label={t.fields.documentFile}
                  list={citedDocuments.length > 0 ? citedListId : undefined}
                  hint={
                    citedDocuments.length > 0
                      ? t.fields.documentFileHint
                      : t.fields.documentFileNone
                  }
                  value={file}
                  onChange={(next) => {
                    const rows = titleRows.map(([f, v], i) =>
                      i === index ? [next ?? '', v] : [f, v],
                    );
                    onChange(['citations', 'documentTitles'], Object.fromEntries(rows));
                  }}
                />
                <TextField
                  label={t.fields.documentTitle}
                  value={title}
                  onChange={(next) => {
                    onChange(['citations', 'documentTitles'], { ...titles, [file]: next ?? '' });
                  }}
                />
                <button
                  type="button"
                  class="button button--quiet"
                  onClick={() => {
                    onChange(
                      ['citations', 'documentTitles'],
                      Object.fromEntries(titleRows.filter((_, i) => i !== index)),
                    );
                  }}
                >
                  {t.fields.remove}
                </button>
              </div>
            ))}
            {errorsFor('citations.documentTitles') && (
              <ul class="field__errors">
                {errorsFor('citations.documentTitles')?.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            <button
              type="button"
              class="button"
              onClick={() => {
                onChange(['citations', 'documentTitles'], { ...titles, '': '' });
              }}
            >
              {t.fields.addDocument}
            </button>
          </fieldset>
          <SwitchRow
            icon={TextQuote}
            title={t.fields.showSnippets}
            description={t.ux.snippetsDescription}
            checked={value('citations.showSnippets') === true}
            onChange={set('citations.showSnippets')}
          />
        </Section>
      )}
      {area === 'behavior' && (
        <Section id="behavior" title={t.sections.behavior ?? ''}>
          <SwitchRow
            icon={Lightbulb}
            title={t.fields.suggestions}
            description={t.fields.suggestionsHint}
            checked={value('behavior.suggestionsAfterAnswer') === true}
            onChange={set('behavior.suggestionsAfterAnswer')}
          />
          <NumberField
            label={t.fields.cookieDays}
            value={num(value('behavior.visitorCookieDays'))}
            defaultValue={30}
            min={1}
            max={395}
            onChange={set('behavior.visitorCookieDays')}
            errors={errorsFor('behavior.visitorCookieDays')}
          />
          <TextField
            label={t.fields.privacyPolicyUrl}
            type="url"
            value={str(value('behavior.privacyPolicyUrl'))}
            onChange={set('behavior.privacyPolicyUrl')}
            errors={errorsFor('behavior.privacyPolicyUrl')}
            placeholder="https://"
          />
        </Section>
      )}
      {area === 'domains' && (
        <Section id="allowedOrigins" title={t.sections.allowedOrigins ?? ''}>
          <p class="warning">{t.fields.originsWarning}</p>
          <OriginsList
            origins={origins}
            errorsAt={(index) => errors[`allowedOrigins.${String(index)}`]}
            listErrors={errors.allowedOrigins}
            onChange={(next) => {
              onChange(['allowedOrigins'], next);
            }}
          />
        </Section>
      )}
      {area === 'integration' && integration && (
        <IntegrationSection
          tenant={tenant}
          gatewayOrigin={integration.gatewayOrigin}
          origins={integration.origins}
          checkInstallations={integration.checkInstallations}
          {...(integration.domainsStatus ? { domainsStatus: integration.domainsStatus } : {})}
          {...(integration.onDomains ? { onDomains: integration.onDomains } : {})}
        />
      )}
    </div>
  );
}
