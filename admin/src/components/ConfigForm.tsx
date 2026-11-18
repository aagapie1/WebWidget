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

export interface ConfigFormProps {
  tenant: string;
  config: Config;
  errors: FieldErrors;
  permissions: ConfigState['permissions'];
  onChange: (path: Path, value: unknown) => void;
  upload: (file: File) => Promise<{ file: string }>;
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
}: ConfigFormProps) {
  const { t } = useI18n();
  const value = (path: string) => getIn(config, path.split('.'));
  const errorsFor = (path: string) => errors[path];
  const set = (path: string) => (next: unknown) => {
    onChange(path.split('.'), next);
  };
  const image = (path: string, label: string) => (
    <ImageField
      label={label}
      tenant={tenant}
      value={str(value(path)) === 'none' ? undefined : str(value(path))}
      canUpload={permissions.assets}
      upload={upload}
      onChange={set(path)}
      errors={errorsFor(path)}
    />
  );
  const icon = value('launcher.icon');
  const iconFile =
    typeof icon === 'string'
      ? icon
      : str(getIn(icon, ['type'])) === 'asset'
        ? str(getIn(icon, ['file']))
        : undefined;
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
        {image('identity.logo', t.fields.logo)}
        {image('identity.assistantAvatar', t.fields.assistantAvatar)}
        {image('identity.userAvatar', t.fields.userAvatar)}
      </Section>

      <Section id="launcher" title={t.sections.launcher ?? ''}>
        <fieldset class="field">
          <legend>{t.fields.icon}</legend>
          <label class="choice">
            <input
              type="radio"
              name="launcher-icon"
              checked={iconFile === undefined}
              onChange={() => {
                onChange(['launcher', 'icon'], undefined);
              }}
            />
            {t.fields.iconBuiltin}
          </label>
          <label class="choice">
            <input
              type="radio"
              name="launcher-icon"
              checked={iconFile !== undefined}
              disabled={iconFile === undefined}
            />
            {t.fields.iconImage}
          </label>
        </fieldset>
        <ImageField
          label={t.fields.iconImage}
          tenant={tenant}
          value={iconFile}
          canUpload={permissions.assets}
          upload={upload}
          onChange={(file) => {
            onChange(['launcher', 'icon'], file ? { type: 'asset', file } : undefined);
          }}
          errors={errorsFor('launcher.icon')}
        />
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
            placeholder={24}
            min={0}
            max={200}
            onChange={set('launcher.offsetX')}
            errors={errorsFor('launcher.offsetX')}
          />
          <NumberField
            label={t.fields.offsetY}
            value={num(value('launcher.offsetY'))}
            placeholder={24}
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
            placeholder={380}
            min={320}
            max={520}
            onChange={set('window.width')}
            errors={errorsFor('window.width')}
          />
          <NumberField
            label={t.fields.height}
            value={num(value('window.height'))}
            placeholder={640}
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
            placeholder={15}
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
          placeholder={30}
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
    </div>
  );
}
