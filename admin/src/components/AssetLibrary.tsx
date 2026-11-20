import { useEffect, useState } from 'preact/hooks';
import { ApiError, type AdminApi, type StoredAsset } from '../api.js';
import { formatDateTime, useI18n } from '../i18n.js';
import { ConfirmDialog } from './ConfirmDialog.js';

interface AssetLibraryProps {
  api: AdminApi;
  tenant: string;
  /** Administrators delete; editors only see the list. */
  canDelete: boolean;
  /** Changes whenever the draft is saved: the usage is read again. */
  refresh: string;
  onSessionExpired: () => void;
}

type Notice = { kind: 'ok' | 'error'; text: string } | undefined;

/** Uploaded images, where each is used, and deleting an unused one (E5 K6). */
export function AssetLibrary({
  api,
  tenant,
  canDelete,
  refresh,
  onSessionExpired,
}: AssetLibraryProps) {
  const { t, locale } = useI18n();
  const [assets, setAssets] = useState<StoredAsset[] | undefined>();
  const [failed, setFailed] = useState(false);
  const [deleting, setDeleting] = useState<{ name: string; busy: boolean } | undefined>();
  const [notice, setNotice] = useState<Notice>();

  const load = () =>
    api.listAssets(tenant).then(
      (result) => {
        setAssets(result.assets);
        setFailed(false);
      },
      (error: unknown) => {
        if (error instanceof ApiError && error.status === 401) onSessionExpired();
        else setFailed(true);
      },
    );

  useEffect(() => {
    void load();
  }, [api, tenant, refresh]);

  const remove = (name: string) => {
    setDeleting({ name, busy: true });
    api.deleteAsset(tenant, name).then(
      async () => {
        setDeleting(undefined);
        setNotice({ kind: 'ok', text: t.images.deleted(name) });
        await load();
      },
      async (error: unknown) => {
        setDeleting(undefined);
        if (error instanceof ApiError && error.status === 401) {
          onSessionExpired();
          return;
        }
        const inUse = error instanceof ApiError && error.code === 'asset_in_use';
        setNotice({ kind: 'error', text: inUse ? t.images.inUse : t.images.deleteFailed });
        await load();
      },
    );
  };

  const usage = (asset: StoredAsset): string =>
    [
      ...(asset.versions.length > 0 ? [t.images.inVersions(asset.versions.join(', '))] : []),
      ...(asset.draft ? [t.images.inDraft] : []),
    ].join(' · ') || t.images.unused;

  return (
    <section class="card asset-library" aria-labelledby="section-assets">
      <h2 id="section-assets">{t.images.library}</h2>
      <p class="field__hint">{t.images.libraryIntro}</p>
      <p
        role="status"
        class={notice?.kind === 'error' ? 'notice notice--error' : 'asset-library__status'}
      >
        {notice?.text ?? ''}
      </p>
      {failed && <p class="notice notice--error">{t.images.libraryFailed}</p>}
      {assets?.length === 0 && <p class="field__hint">{t.images.libraryEmpty}</p>}
      {assets && assets.length > 0 && (
        <ul class="asset-library__list">
          {assets.map((asset) => {
            const unused = asset.versions.length === 0 && !asset.draft;
            return (
              <li key={asset.name} class="asset-library__item">
                <img
                  class="asset-library__thumb"
                  src={`/admin/api/tenants/${encodeURIComponent(tenant)}/assets/${encodeURIComponent(asset.name)}`}
                  alt=""
                  width={48}
                  height={48}
                />
                <div class="asset-library__info">
                  <span class="asset-library__name">{asset.name}</span>
                  <span class="field__hint">
                    {t.images.uploadedBy(asset.createdBy, formatDateTime(asset.createdAt, locale))}{' '}
                    · {String(Math.round(asset.bytes / 1024))} KB
                  </span>
                  <span
                    class={
                      unused
                        ? 'asset-library__usage'
                        : 'asset-library__usage asset-library__usage--used'
                    }
                  >
                    {usage(asset)}
                  </span>
                </div>
                {canDelete && unused && (
                  <button
                    type="button"
                    class="button button--danger"
                    aria-label={t.images.deleteFor(asset.name)}
                    onClick={() => {
                      setNotice(undefined);
                      setDeleting({ name: asset.name, busy: false });
                    }}
                  >
                    {t.images.deleteConfirm}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {deleting && (
        <ConfirmDialog
          title={t.images.deleteTitle}
          body={t.images.deleteBody(deleting.name)}
          confirmLabel={t.images.deleteConfirm}
          cancelLabel={t.ux.cancel}
          busy={deleting.busy}
          onCancel={() => {
            setDeleting(undefined);
          }}
          onConfirm={() => {
            remove(deleting.name);
          }}
        />
      )}
    </section>
  );
}
