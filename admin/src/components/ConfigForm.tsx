import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { DEFAULT_THEME } from 'gateway/config-schema';
import { TEXT_KEYS } from 'gateway/texts';
import { texts as widgetTexts } from 'widget/i18n';
import type { Config, ConfigState } from '../api.js';
import { useI18n } from '../i18n.js';
import { getIn, type FieldErrors, type Path } from '../model.js';
import { ColorField } from './ColorField.js';
import { CheckboxField, Field, NumberField, SelectField, TextField } from './Field.js';
import { ImageField } from './ImageField.js';
import { IntegrationSection } from './IntegrationSection.js';
import { NodeIcon, OptionGrid, type GridOption } from './OptionGrid.js';
import { QuestionsEditor } from './QuestionsEditor.js';
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
  /** "Integrare pe site"; omitted when the gateway address is unknown. */
  integration?:
    | {
        gatewayOrigin: string;
        origins: readonly string[];
        checkInstallations: () => Promise<{ installations: Installation[] }>;
      }
    | undefined;
}

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

const COLOR_KEYS = [
  'accent',
  'accentEnd',
  'onAccent',
  'text',
  'textMuted',
  'background',
  'assistantBubble',
  'link',
  'userBubble',
  'onUserBubble',
  'button',
  'onButton',
] as const;

/** Optional colors fall back to these when unset (gateway contrastChecks rules). */
const COLOR_FALLBACK: Record<string, keyof typeof DEFAULT_THEME> = {
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
function OriginsField(props: {
  origins: string[];
  editable: boolean;
  errors: string[];
  onChange: (origins: string[]) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(props.origins.join('\n'));
  return (
    <Field
      label={t.fields.origins}
      hint={props.editable ? t.fields.originsHint : t.fields.originsReadOnly}
      errors={props.errors}
    >
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          rows={4}
          readOnly={!props.editable}
          value={text}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          spellcheck={false}
          onInput={(event) => {
            const raw = event.currentTarget.value;
            setText(raw);
            props.onChange(
              raw
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean),
            );
          }}
        />
      )}
    </Field>
  );
}

/** The editable configuration (spec §5.1), grouped in sections. */
export function ConfigForm({
  tenant,
  config,
  errors,
  permissions,
  onChange,
  upload,
  accent,
  onAccent,
  assistantQuestions,
  integration,
}: ConfigFormProps) {
  const { t } = useI18n();
  // "Imagine încărcată" chosen but nothing uploaded yet: show the upload field.
  const [imageChoice, setImageChoice] = useState<Record<string, boolean>>({});
  const chooseImage = (key: string, on: boolean) => {
    setImageChoice((current) => ({ ...current, [key]: on }));
  };
  const swatch = (content: preact.ComponentChildren) => (
    <span class="swatch" style={{ background: accent, color: onAccent }}>
      {content}
    </span>
  );
  const value = (path: string) => getIn(config, path.split('.'));
  const errorsFor = (path: string) => errors[path];
  const set = (path: string) => (next: unknown) => {
    onChange(path.split('.'), next);
  };
  const thumb = (file: string | undefined) =>
    file ? (
      <img
        class="tile__image"
        alt=""
        src={`/admin/api/tenants/${encodeURIComponent(tenant)}/assets/${encodeURIComponent(file)}`}
      />
    ) : (
      <span class="tile__upload">↑</span>
    );

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
    { value: 'image', label: t.ux.uploadedImage, visual: thumb(iconFile) },
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
    { value: 'image', label: t.ux.avatarOptions.image ?? '', visual: thumb(assistantFile) },
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
    { value: 'image', label: t.ux.userAvatarOptions.image ?? '', visual: thumb(userFile) },
  ];
  const proactiveOn = value('proactive.enabled') === true;
  const theme = (key: string) => str(value(`theme.${key}`));
  const fallbackColor = (key: string): string => {
    const base = COLOR_FALLBACK[key];
    if (base) return theme(base) ?? DEFAULT_THEME[base];
    return DEFAULT_THEME[key as keyof typeof DEFAULT_THEME];
  };
  const origins = Array.isArray(value('allowedOrigins'))
    ? (value('allowedOrigins') as string[])
    : [];
  const titles = (value('citations.documentTitles') ?? {}) as Record<string, string>;
  const titleRows = Object.entries(titles);

  return (
    <div class="form">
      <Section id="identity" title={t.sections.identity ?? ''}>
        <TextField
          label={t.fields.name}
          value={str(value('name'))}
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
        <ImageField
          label={t.fields.logo}
          tenant={tenant}
          value={str(value('identity.logo'))}
          canUpload={permissions.assets}
          upload={upload}
          onChange={set('identity.logo')}
          errors={errorsFor('identity.logo')}
        />
        <OptionGrid
          legend={t.fields.assistantAvatar}
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
            tenant={tenant}
            value={assistantFile}
            canUpload={permissions.assets}
            upload={upload}
            onChange={(file) => {
              onChange(['identity', 'assistantAvatar'], file ? { type: 'asset', file } : undefined);
              if (!file) chooseImage('assistant', false);
            }}
            errors={errorsFor('identity.assistantAvatar')}
          />
        )}
        <OptionGrid
          legend={t.fields.userAvatar}
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

      <Section id="launcher" title={t.sections.launcher ?? ''}>
        <OptionGrid
          legend={t.fields.icon}
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

      <Section id="window" title={t.sections.window ?? ''}>
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
        <SelectField
          label={t.fields.windowPosition}
          value={str(value('window.position')) ?? 'auto'}
          options={[
            { value: 'auto', label: t.fields.auto },
            { value: 'bottom-right', label: t.fields.bottomRight },
            { value: 'bottom-left', label: t.fields.bottomLeft },
          ]}
          onChange={set('window.position')}
        />
        <h3>{t.fields.colors}</h3>
        <div class="grid">
          {COLOR_KEYS.map((key) => (
            <ColorField
              key={key}
              label={t.fields.color[key] ?? key}
              value={theme(key)}
              fallback={fallbackColor(key)}
              onChange={set(`theme.${key}`)}
              errors={errorsFor(`theme.${key}`)}
            />
          ))}
        </div>
      </Section>

      <Section id="texts" title={t.sections.texts ?? ''}>
        {(['ro', 'en'] as const).map((locale) => {
          const defaults = widgetTexts(locale) as unknown as Record<string, unknown>;
          const field = (key: string, label: string, hint?: string) => (
            <TextField
              key={key}
              label={label}
              hint={hint}
              value={str(value(`texts.${locale}`) && getIn(value(`texts.${locale}`), [key]))}
              placeholder={str(getIn(defaults, key.split('.')))}
              onChange={(next) => {
                onChange(['texts', locale, key], next);
              }}
              errors={errorsFor(`texts.${locale}.${key}`)}
            />
          );
          return (
            <fieldset key={locale} class="field">
              <legend>{t.fields.textsFor[locale]}</legend>
              {field('welcome', t.fields.welcome, t.fields.welcomeHint)}
              {field('composer.placeholder', t.fields.placeholder)}
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
                {TEXT_KEYS.filter((key) => key !== 'welcome' && key !== 'composer.placeholder').map(
                  (key) => field(key, key),
                )}
              </details>
            </fieldset>
          );
        })}
      </Section>

      <Section id="proactive" title={t.sections.proactive ?? ''}>
        <CheckboxField
          label={t.fields.proactiveEnabled}
          checked={value('proactive.enabled') === true}
          onChange={set('proactive.enabled')}
        />
        {!proactiveOn && <p class="field__hint">{t.ux.proactiveOff}</p>}
        {proactiveOn && (
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
            <CheckboxField
              label={t.fields.showOnMobile}
              checked={value('proactive.showOnMobile') === true}
              onChange={set('proactive.showOnMobile')}
            />
          </>
        )}
      </Section>

      <Section id="citations" title={t.sections.citations ?? ''}>
        <fieldset class="field">
          <legend>{t.fields.documentTitles}</legend>
          {titleRows.map(([file, title], index) => (
            <div class="row row--titles" key={index}>
              <TextField
                label={t.fields.documentFile}
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
        <CheckboxField
          label={t.fields.showSnippets}
          checked={value('citations.showSnippets') === true}
          onChange={set('citations.showSnippets')}
        />
      </Section>

      <Section id="behavior" title={t.sections.behavior ?? ''}>
        <CheckboxField
          label={t.fields.suggestions}
          hint={t.fields.suggestionsHint}
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

      <Section id="allowedOrigins" title={t.sections.allowedOrigins ?? ''}>
        <p class="warning">{t.fields.originsWarning}</p>
        <OriginsField
          origins={origins}
          editable={permissions.origins}
          errors={Object.entries(errors)
            .filter(([path]) => path.startsWith('allowedOrigins'))
            .flatMap(([, list]) => list)}
          onChange={(next) => {
            onChange(['allowedOrigins'], next);
          }}
        />
      </Section>

      {integration && (
        <IntegrationSection
          tenant={tenant}
          gatewayOrigin={integration.gatewayOrigin}
          origins={integration.origins}
          checkInstallations={integration.checkInstallations}
        />
      )}
    </div>
  );
}
