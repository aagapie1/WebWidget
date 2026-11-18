import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { PreviewState } from 'widget/messages';
import {
  ApiError,
  type AdminApi,
  type Config,
  type ConfigState,
  type DraftConflict,
} from '../api.js';
import { formatDateTime, formatTime, useI18n } from '../i18n.js';
import {
  changedSections,
  contrastResults,
  effectiveTheme,
  errorCount,
  serverErrors,
  setIn,
  stash,
  validate,
  type FieldErrors,
  type Path,
} from '../model.js';
import { ConfigForm } from './ConfigForm.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { useFitToViewport, useMediaQuery } from '../fit-viewport.js';
import { PreviewPanel } from './PreviewPanel.js';
import { PublishBar } from './PublishBar.js';
import { PublishDialog } from './PublishDialog.js';
import { SaveStatus, type SaveState } from './SaveStatus.js';

export const AUTOSAVE_MS = 800;

interface EditorProps {
  api: AdminApi;
  tenant: string;
  /** Called after unsaved edits were stashed: the app signs in again and comes back. */
  onSessionExpired: () => void;
  /** Public gateway address, for the integration snippet. */
  gatewayOrigin?: string | undefined;
}

interface Base {
  /** Published version the edits start from. */
  version: number;
  /** Draft revision the edits start from (`null`: no draft). */
  revision: number | null;
}

export function Editor({ api, tenant, onSessionExpired, gatewayOrigin }: EditorProps) {
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
  // The preview column always fits the visible screen (launcher in view, no scrolling).
  const side = useRef<HTMLElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  // The preview column starts below the sticky status bar and reaches the bottom of the window.
  const barBottom = useCallback(() => bar.current?.getBoundingClientRect().bottom ?? 0, []);
  useFitToViewport(side, state !== undefined, barBottom);
  // Below 1280 px the preview is a side panel opened from the status bar (never squeezed).
  const narrow = useMediaQuery('(max-width: 1279px)');
  const [previewOpen, setPreviewOpen] = useState(false);
  // The preview follows the section being edited (launcher, proactive bubble, open window).
  const [previewShow, setPreviewShow] = useState<PreviewState>('window');
  const followSection = (event: FocusEvent) => {
    const section = (event.target as Element | null)?.closest('section[aria-labelledby]');
    const id = section?.getAttribute('aria-labelledby');
    setPreviewShow(
      id === 'section-launcher' ? 'launcher' : id === 'section-proactive' ? 'proactive' : 'window',
    );
  };
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
      setSave(next.draft ? { kind: 'saved', at: next.draft.updatedAt } : { kind: 'idle' });
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

  // The assistant's own starter questions (Dify), suggested when a language has none.
  const [assistantQuestions, setAssistantQuestions] = useState<readonly string[]>([]);
  useEffect(() => {
    api.assistantDefaults(tenant).then(
      (defaults) => {
        setAssistantQuestions(defaults.suggestedQuestions);
      },
      () => undefined,
    );
  }, [api, tenant]);
  const [discarding, setDiscarding] = useState<{ busy: boolean } | undefined>();
  const checkInstallations = useCallback(() => api.installations(tenant), [api, tenant]);

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
  const theme = effectiveTheme(config);

  const num = (value: unknown, fallback: number) => (typeof value === 'number' ? value : fallback);
  const windowConfig = (config.window ?? {}) as Record<string, unknown>;
  const launcherConfig = (config.launcher ?? {}) as Record<string, unknown>;
  const widget = {
    width: num(windowConfig.width, 380),
    height: num(windowConfig.height, 640),
    offsetX: num(launcherConfig.offsetX, 24),
    offsetY: num(launcherConfig.offsetY, 24),
  };
  const showContrastProblem = (event: Event) => {
    event.preventDefault();
    const section = document.getElementById('section-window')?.closest('section');
    const field = section?.querySelector<HTMLElement>('[aria-invalid="true"]');
    (field ?? section)?.scrollIntoView({ block: 'center' });
    field?.focus();
  };

  return (
    <div class="workspace">
      {/* Always visible while editing (sticky): state, checks and the actions, like Dify. */}
      <div class="statusbar" ref={bar}>
        <div class="statusbar__state">
          <p class="status__published">
            {t.ux.publishedAt(
              formatDateTime(state.published.createdAt, locale),
              state.published.createdBy,
            )}
          </p>
          <SaveStatus
            state={save}
            onRetry={() => {
              void saveNow();
            }}
          />
        </div>
        <div class="statusbar__checks">
          {failing.length === 0 ? (
            <span class="badge badge--ok">✓ {t.ux.contrastOk}</span>
          ) : (
            <a class="badge badge--error" href="#section-window" onClick={showContrastProblem}>
              ⚠ {t.ux.contrastProblems(failing.length)}
            </a>
          )}
        </div>
        <div class="statusbar__actions">
          {narrow && (
            <button
              type="button"
              class="button"
              aria-expanded={previewOpen}
              aria-controls="preview-column"
              onClick={() => {
                setPreviewOpen((open) => !open);
              }}
            >
              {t.ux.previewButton}
            </button>
          )}
          {base.current.revision !== null && (
            <button
              type="button"
              class="button button--danger-quiet"
              onClick={() => {
                setDiscarding({ busy: false });
              }}
            >
              {t.ux.discard}
            </button>
          )}
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
        </div>
      </div>

      <div class="editor">
        <div class="editor__form" onFocusIn={followSection}>
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
            accent={theme.accent}
            onAccent={theme.onAccent}
            assistantQuestions={assistantQuestions}
            integration={
              gatewayOrigin
                ? {
                    gatewayOrigin,
                    origins: Array.isArray(state.published.config.allowedOrigins)
                      ? (state.published.config.allowedOrigins as string[])
                      : [],
                    checkInstallations,
                  }
                : undefined
            }
          />
        </div>
        <aside
          id="preview-column"
          ref={side}
          class={
            narrow
              ? previewOpen
                ? 'preview-column preview-column--drawer preview-column--open'
                : 'preview-column preview-column--drawer'
              : 'preview-column'
          }
          aria-label={t.preview.title}
          onKeyDown={(event) => {
            if (narrow && event.key === 'Escape') setPreviewOpen(false);
          }}
        >
          {narrow && (
            <button
              type="button"
              class="button preview-column__close"
              onClick={() => {
                setPreviewOpen(false);
              }}
            >
              {t.ux.closePreview}
            </button>
          )}
          <PreviewPanel
            revision={previewRevision}
            createToken={createToken}
            show={previewShow}
            widget={widget}
          />
        </aside>
      </div>
      {discarding && (
        <ConfirmDialog
          title={t.ux.discardTitle}
          body={t.ux.discardBody}
          confirmLabel={t.ux.discardConfirm}
          cancelLabel={t.ux.cancel}
          busy={discarding.busy}
          onCancel={() => {
            setDiscarding(undefined);
          }}
          onConfirm={() => {
            setDiscarding({ busy: true });
            api.discardDraft(tenant).then(
              async () => {
                stash.clear(tenant);
                setDiscarding(undefined);
                await load();
                setSave({ kind: 'discarded' });
                setPreviewRevision((revision) => revision + 1);
              },
              (error: unknown) => {
                setDiscarding(undefined);
                if (error instanceof ApiError && error.status === 401) expired();
                else setSave({ kind: 'error' });
              },
            );
          }}
        />
      )}
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
