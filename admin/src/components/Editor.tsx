import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  ApiError,
  type AdminApi,
  type Config,
  type ConfigState,
  type DraftConflict,
} from '../api.js';
import { formatTime, useI18n } from '../i18n.js';
import {
  changedSections,
  contrastResults,
  errorCount,
  serverErrors,
  setIn,
  stash,
  validate,
  type FieldErrors,
  type Path,
} from '../model.js';
import { ConfigForm } from './ConfigForm.js';
import { PreviewPanel } from './PreviewPanel.js';
import { PublishBar } from './PublishBar.js';
import { PublishDialog } from './PublishDialog.js';
import { SaveStatus, type SaveState } from './SaveStatus.js';

export const AUTOSAVE_MS = 1200;

interface EditorProps {
  api: AdminApi;
  tenant: string;
  /** Called after unsaved edits were stashed: the app signs in again and comes back. */
  onSessionExpired: () => void;
}

interface Base {
  /** Published version the edits start from. */
  version: number;
  /** Draft revision the edits start from (`null`: no draft). */
  revision: number | null;
}

export function Editor({ api, tenant, onSessionExpired }: EditorProps) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<ConfigState | undefined>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [config, setConfig] = useState<Config>({});
  const [savedJson, setSavedJson] = useState('');
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [conflict, setConflict] = useState<DraftConflict | undefined>();
  const [serverMessages, setServerMessages] = useState<string[]>([]);
  const [restored, setRestored] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [formKey, setFormKey] = useState(0);
  const [publishing, setPublishing] = useState<{ busy: boolean; error?: string } | undefined>();
  const base = useRef<Base>({ version: 0, revision: null });
  const latest = useRef(config);
  latest.current = config;
  const saving = useRef(false);

  const expired = useCallback(() => {
    stash.save(tenant, {
      config: latest.current,
      baseVersion: base.current.version,
      draftRevision: base.current.revision,
    });
    onSessionExpired();
  }, [tenant, onSessionExpired]);

  const load = useCallback(async () => {
    try {
      const next = await api.config(tenant);
      const working = next.draft?.config ?? next.published.config;
      base.current = { version: next.published.version, revision: next.draft?.revision ?? null };
      setState(next);
      setServerMessages(next.errors);
      setSavedJson(JSON.stringify(working));
      setConflict(undefined);
      // Edits kept across a re-login (request 3): restored and saved from their own base, so a
      // concurrent change is still detected.
      const pending = stash.load(tenant);
      if (pending && JSON.stringify(pending.config) !== JSON.stringify(working)) {
        base.current = { version: pending.baseVersion, revision: pending.draftRevision };
        setConfig(pending.config);
        setRestored(true);
      } else {
        stash.clear(tenant);
        setConfig(working);
      }
      setFormKey((key) => key + 1);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) expired();
      else setLoadFailed(true);
    }
  }, [api, tenant, expired]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveNow = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    const sent = latest.current;
    setSave({ kind: 'saving' });
    try {
      const result = await api.saveDraft(tenant, {
        config: sent,
        baseVersion: base.current.version,
        draftRevision: base.current.revision,
      });
      base.current = { ...base.current, revision: result.revision };
      const json = JSON.stringify(sent);
      setSavedJson(json);
      if (JSON.stringify(latest.current) === json) stash.clear(tenant);
      setServerMessages(result.errors);
      setSave({ kind: 'saved', at: result.savedAt });
      setRestored(false);
      setPreviewRevision((revision) => revision + 1);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        expired();
      } else if (error instanceof ApiError && error.code === 'draft_conflict') {
        // Never overwrite: keep the local edits on screen, stop autosaving (request 1).
        setConflict(error.details as unknown as DraftConflict);
        setSave({ kind: 'conflict' });
      } else {
        setSave({ kind: 'error' });
      }
    } finally {
      saving.current = false;
    }
  }, [api, tenant, expired]);

  // Autosave (spec §5.3): shortly after the last change; the edits are also stashed so that a
  // session expiry loses nothing.
  useEffect(() => {
    if (!state || conflict) return;
    const json = JSON.stringify(config);
    if (json === savedJson) return;
    stash.save(tenant, {
      config,
      baseVersion: base.current.version,
      draftRevision: base.current.revision,
    });
    setSave((current) => (current.kind === 'saving' ? current : { kind: 'pending' }));
    const timer = setTimeout(() => {
      void saveNow();
    }, AUTOSAVE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [config, savedJson, state, conflict, tenant, saveNow]);

  const onChange = useCallback((path: Path, value: unknown) => {
    setConfig((current) => setIn(current, path, value));
  }, []);

  const clientErrors = useMemo(() => validate(tenant, config, t), [tenant, config, t]);
  const errors: FieldErrors = useMemo(() => {
    const merged: FieldErrors = { ...clientErrors };
    for (const [path, list] of Object.entries(serverErrors(serverMessages))) {
      merged[path] = [
        ...(merged[path] ?? []),
        ...list.filter((m) => !(merged[path] ?? []).includes(m)),
      ];
    }
    return merged;
  }, [clientErrors, serverMessages]);
  const count = errorCount(errors);

  const createToken = useCallback(() => api.previewToken(tenant), [api, tenant]);
  const upload = useCallback(
    (file: File) => api.uploadAsset(tenant, file, file.name),
    [api, tenant],
  );

  if (loadFailed) return <p role="alert">{t.errors.loadFailed}</p>;
  if (!state) return <p>{t.loading}</p>;

  const sections = changedSections(state.published.config, config);
  const pendingSave =
    save.kind === 'pending' || save.kind === 'saving' || JSON.stringify(config) !== savedJson;
  const hasChanges = sections.length > 0 && base.current.revision !== null;

  const publish = async (comment: string) => {
    if (base.current.revision === null) return;
    setPublishing({ busy: true });
    try {
      const result = await api.publish(tenant, {
        ...(comment ? { comment } : {}),
        draftRevision: base.current.revision,
      });
      setPublishing(undefined);
      await load();
      setSave({ kind: 'published', version: result.version });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        expired();
      } else if (error instanceof ApiError && error.code === 'draft_conflict') {
        setPublishing(undefined);
        setConflict(error.details as unknown as DraftConflict);
        setSave({ kind: 'conflict' });
      } else {
        if (error instanceof ApiError && Array.isArray(error.details.errors)) {
          setServerMessages(error.details.errors as string[]);
        }
        setPublishing({ busy: false, error: t.publish.failed });
      }
    }
  };

  const failing = contrastResults(config).filter((check) => !check.ok);

  return (
    <div class="editor">
      <div class="editor__form">
        {restored && (
          <p class="notice" role="status">
            {t.save.restored}
          </p>
        )}
        {conflict && (
          <div class="notice notice--error" role="alert">
            <h2>{t.conflict.title}</h2>
            <p>
              {conflict.draft
                ? t.conflict.byUser(
                    conflict.draft.updatedBy,
                    formatTime(conflict.draft.updatedAt, locale),
                  )
                : t.conflict.published(conflict.publishedVersion)}
            </p>
            <button
              type="button"
              class="button"
              onClick={() => {
                stash.clear(tenant);
                void load();
              }}
            >
              {t.conflict.reload}
            </button>
          </div>
        )}
        {count > 0 && (
          <div class="notice notice--error">
            <h2>{t.errors.summary(count)}</h2>
            <ul>
              {Object.entries(errors).flatMap(([path, list]) =>
                list.map((message) => (
                  <li key={`${path}:${message}`}>
                    <code>{path}</code> — {message}
                  </li>
                )),
              )}
            </ul>
          </div>
        )}
        <ConfigForm
          key={formKey}
          tenant={tenant}
          config={config}
          errors={errors}
          permissions={state.permissions}
          onChange={onChange}
          upload={upload}
        />
      </div>
      <aside class="editor__side">
        <div class="card">
          <SaveStatus
            state={save}
            onRetry={() => {
              void saveNow();
            }}
          />
          <PublishBar
            canPublish={state.permissions.publish}
            errorCount={count}
            hasChanges={hasChanges}
            saving={pendingSave}
            conflict={conflict !== undefined}
            onPublish={() => {
              setPublishing({ busy: false });
            }}
          />
          <h2 class="small-heading">{t.contrastTitle}</h2>
          {failing.length === 0 ? (
            <p class="ok">{t.contrastOk}</p>
          ) : (
            <ul class="contrast">
              {failing.map((check) => (
                <li key={`${check.foreground}/${check.background}`}>
                  {t.fields.color[check.foreground]} / {t.fields.color[check.background]}:{' '}
                  {check.ratio.toFixed(2)}:1 (min. {check.minimum}:1)
                </li>
              ))}
            </ul>
          )}
        </div>
        <PreviewPanel revision={previewRevision} createToken={createToken} />
      </aside>
      {publishing && (
        <PublishDialog
          nextVersion={state.published.version + 1}
          sections={sections}
          busy={publishing.busy}
          error={publishing.error}
          onConfirm={(comment) => {
            void publish(comment);
          }}
          onCancel={() => {
            setPublishing(undefined);
          }}
        />
      )}
    </div>
  );
}
