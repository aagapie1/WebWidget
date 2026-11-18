import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { PreviewState } from 'widget/messages';
import {
  ApiError,
  type Role,
  type AdminApi,
  type Config,
  type ConfigState,
  type DraftConflict,
} from '../api.js';
import { formatDateTime, formatTime, useI18n, type Locale } from '../i18n.js';
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
import { AppHeader } from './AppHeader.js';
import { ConfigForm, type Area } from './ConfigForm.js';
import { AREAS, Sidebar } from './Sidebar.js';
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
  /** Header data and actions (user menu, language, client switch). */
  frame?: EditorFrame | undefined;
}

export interface EditorFrame {
  user: { name: string; role: Role; org: string };
  tenants: readonly string[];
  onTenant: (tenant: string) => void;
  onLocale: (locale: Locale) => void;
  onLogout: () => void;
}

/** Which sidebar area a field (error path) or a changed section belongs to. */
export function areaOf(path: string): Area {
  const key = path.split('.')[0] ?? '';
  if (key === 'texts') return 'texts';
  if (key === 'proactive') return 'proactive';
  if (key === 'citations') return 'citations';
  if (key === 'behavior' || key === 'feedback') return 'behavior';
  if (key === 'allowedOrigins') return 'domains';
  return 'aspect';
}

function initialArea(): Area {
  const hash = typeof location === 'undefined' ? '' : location.hash.slice(1);
  return (AREAS as readonly string[]).includes(hash) ? (hash as Area) : 'aspect';
}

interface Base {
  /** Published version the edits start from. */
  version: number;
  /** Draft revision the edits start from (`null`: no draft). */
  revision: number | null;
}

export function Editor({ api, tenant, onSessionExpired, gatewayOrigin, frame }: EditorProps) {
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
  // One area at a time (sidebar). The preview shows the open window everywhere, except while
  // the launcher is edited (closed launcher) and in "Mesaj proactiv" (the bubble).
  const [area, setAreaState] = useState<Area>(initialArea);
  const [editingLauncher, setEditingLauncher] = useState(false);
  /** After an area change: the section to scroll to, the area title, or the first invalid field. */
  const pendingFocus = useRef<string | undefined>(undefined);
  // Bumped on every navigation, so that a link inside the current area still scrolls.
  const [navigation, setNavigation] = useState(0);
  const setArea = useCallback((next: Area, subsection?: string, focus?: 'invalid') => {
    setAreaState(next);
    setEditingLauncher(false);
    setNavigation((value) => value + 1);
    pendingFocus.current = focus ?? (subsection ? `section-${subsection}` : 'area-title');
    try {
      history.replaceState(null, '', `#${next}`);
    } catch {
      // ignore (sandboxed documents)
    }
  }, []);
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = undefined;
    if (target === 'invalid') {
      const field = document.querySelector<HTMLElement>('.workspace__form [aria-invalid="true"]');
      field?.scrollIntoView({ block: 'center' });
      field?.focus();
      return;
    }
    const element = document.getElementById(target);
    if (target === 'area-title') {
      // A new area starts at the top of the page, header included.
      window.scrollTo({ top: 0 });
      element?.focus({ preventScroll: true });
    } else {
      element?.scrollIntoView({ block: 'start' });
    }
  }, [navigation]);
  const followSection = (event: FocusEvent) => {
    const section = (event.target as Element | null)?.closest('section[aria-labelledby]');
    setEditingLauncher(section?.getAttribute('aria-labelledby') === 'section-launcher');
  };
  const previewShow: PreviewState =
    area === 'proactive' ? 'proactive' : editingLauncher ? 'launcher' : 'window';
  // The sticky bar's height places the sidebar and the preview column under it.
  useEffect(() => {
    const element = bar.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty(
        '--bar-height',
        `${String(element.offsetHeight)}px`,
      );
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  });
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
  const identityConfig = (config.identity ?? {}) as Record<string, unknown>;
  const widget = {
    width: num(windowConfig.width, 380),
    height: num(windowConfig.height, 640),
    offsetX: num(launcherConfig.offsetX, 24),
    offsetY: num(launcherConfig.offsetY, 24),
  };
  const clientName = typeof config.name === 'string' ? config.name : tenant;
  const assistantName =
    typeof identityConfig.assistantName === 'string' ? identityConfig.assistantName : clientName;
  const logoUrl =
    typeof identityConfig.logo === 'string'
      ? `/admin/api/tenants/${encodeURIComponent(tenant)}/assets/${encodeURIComponent(identityConfig.logo)}`
      : undefined;

  // The allowed domains are for administrators (E4b.1 UX 14): editors do not see the area.
  const visibleAreas = state.permissions.origins
    ? AREAS
    : AREAS.filter((item) => item !== 'domains');
  const shown: Area = visibleAreas.includes(area) ? area : 'aspect';
  // Errors per area (sidebar) and in the status bar; contrast has its own indicator.
  const errorPaths = Object.entries(errors).filter(([, list]) => list.length > 0);
  const areaErrors: Partial<Record<Area, number>> = {};
  for (const [path, list] of errorPaths) {
    const key = areaOf(path);
    areaErrors[key] = (areaErrors[key] ?? 0) + list.length;
  }
  const otherErrors = errorPaths.filter(([path]) => !path.startsWith('theme.'));
  const otherCount = otherErrors.reduce((sum, [, list]) => sum + list.length, 0);
  const changedAreas = new Set(
    sections.map((section) => areaOf(section === 'identity' ? 'identity' : section)),
  );
  const goToField = (path: string | undefined, subsection?: string) => (event: Event) => {
    event.preventDefault();
    const target = path ? areaOf(path) : 'aspect';
    setArea(target, subsection, 'invalid');
  };
  const published = state.published;
  const publishedText =
    published.createdBy === 'seed:yaml'
      ? `${t.ux.publishedAt(formatDateTime(published.createdAt, locale), '').replace(/ de $/, '')} · ${t.ux.initialConfig}`
      : t.ux.publishedAt(formatDateTime(published.createdAt, locale), published.createdBy);
  const canDiscard = base.current.revision !== null;
  const draftOrigins = Array.isArray(config.allowedOrigins)
    ? (config.allowedOrigins as string[])
    : [];

  return (
    <div class="shell">
      <AppHeader
        assistantName={assistantName}
        clientName={clientName}
        logoUrl={logoUrl}
        user={frame?.user}
        tenants={frame?.tenants}
        tenant={tenant}
        onTenant={frame?.onTenant}
        onLocale={frame?.onLocale ?? (() => undefined)}
        onLogout={frame?.onLogout}
      />
      {/* Always visible while editing (sticky): state, checks and the one primary action. */}
      <div class="statusbar" ref={bar}>
        <div class="statusbar__state">
          <p class="status__published">{publishedText}</p>
          <SaveStatus
            state={save}
            onRetry={() => {
              void saveNow();
            }}
          />
        </div>
        <div class="statusbar__checks">
          {otherCount > 0 && (
            <a class="badge badge--error" href="#" onClick={goToField(otherErrors[0]?.[0])}>
              ⚠ {t.ux.errorsCount(otherCount)}
            </a>
          )}
          {failing.length === 0 ? (
            <span class="badge badge--ok">✓ {t.ux.contrastOk}</span>
          ) : (
            <a
              class="badge badge--error"
              href="#section-colors"
              onClick={goToField('theme', 'colors')}
            >
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
          <div class="publish-bar">
            <button
              type="button"
              class="button"
              aria-disabled={canDiscard ? undefined : 'true'}
              aria-describedby={canDiscard ? undefined : 'discard-blocker'}
              onClick={() => {
                if (canDiscard) setDiscarding({ busy: false });
              }}
            >
              {t.ux.discard}
            </button>
            {!canDiscard && (
              <span id="discard-blocker" role="tooltip" class="tooltip">
                {t.ux.discardNothing}
              </span>
            )}
          </div>
          <PublishBar
            canPublish={state.permissions.publish}
            errorCount={count}
            hasChanges={hasChanges}
            saving={pendingSave}
            conflict={conflict !== undefined}
            changeCount={sections.length}
            onPublish={() => {
              setPublishing({ busy: false });
            }}
          />
        </div>
      </div>

      <div class="workspace">
        <Sidebar
          area={shown}
          visible={visibleAreas}
          changed={changedAreas}
          errors={areaErrors}
          onArea={setArea}
        />
        <main class="workspace__form" onFocusIn={followSection}>
          <h1 class="area-title" id="area-title" tabIndex={-1}>
            {t.ux.areas[shown]}
          </h1>
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
          <ConfigForm
            key={formKey}
            area={shown}
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
                    origins: draftOrigins,
                    domainsStatus:
                      (areaErrors.domains ?? 0) > 0
                        ? 'invalid'
                        : draftOrigins.length === 0
                          ? 'missing'
                          : 'ok',
                    ...(state.permissions.origins
                      ? {
                          onDomains: () => {
                            setArea('domains');
                          },
                        }
                      : {}),
                    checkInstallations,
                  }
                : undefined
            }
          />
        </main>
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
