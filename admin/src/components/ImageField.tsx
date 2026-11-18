import { useId, useState } from 'preact/hooks';
import { ApiError } from '../api.js';
import { useI18n } from '../i18n.js';

export const MAX_UPLOAD_BYTES = 512 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/webp';

interface ImageFieldProps {
  label: string;
  tenant: string;
  /** Stored image name, or undefined. */
  value: string | undefined;
  canUpload: boolean;
  upload: (file: File) => Promise<{ file: string }>;
  onChange: (file: string | undefined) => void;
  errors?: readonly string[] | undefined;
}

/**
 * Image upload with a thumbnail and errors next to the field (request 6). The server checks
 * the real type and re-encodes; the size is also checked here to answer immediately.
 */
export function ImageField(props: ImageFieldProps) {
  const { t } = useI18n();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>();
  const errors = [...(uploadError ? [uploadError] : []), ...(props.errors ?? [])];
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(undefined);
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError(t.images.errors.too_large);
      return;
    }
    setBusy(true);
    try {
      const result = await props.upload(file);
      props.onChange(result.file);
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'default';
      setUploadError(t.images.errors[code] ?? t.images.errors.default);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class={errors.length > 0 ? 'field field--invalid image-field' : 'field image-field'}>
      <span class="field__label" id={`${id}-label`}>
        {props.label}
      </span>
      <div class="image-field__body">
        <div class="image-field__thumb">
          {props.value ? (
            <img
              src={`/admin/api/tenants/${encodeURIComponent(props.tenant)}/assets/${encodeURIComponent(props.value)}`}
              alt={`${t.images.preview}: ${props.label}`}
            />
          ) : (
            <span aria-hidden="true">—</span>
          )}
        </div>
        <div class="image-field__actions">
          {props.canUpload && (
            <label class="button" for={id}>
              {busy ? t.images.uploading : props.value ? t.images.replace : t.images.upload}
            </label>
          )}
          <input
            id={id}
            class="visually-hidden"
            type="file"
            accept={ACCEPT}
            disabled={!props.canUpload || busy}
            aria-labelledby={`${id}-label`}
            aria-describedby={[errors.length > 0 ? errorId : '', hintId].filter(Boolean).join(' ')}
            aria-invalid={errors.length > 0}
            onChange={(event) => {
              const input = event.currentTarget;
              void choose(input.files?.[0]).then(() => {
                input.value = '';
              });
            }}
          />
          {props.canUpload && props.value && (
            <button
              type="button"
              class="button button--quiet"
              onClick={() => {
                props.onChange(undefined);
              }}
            >
              {t.fields.remove}
            </button>
          )}
        </div>
      </div>
      {errors.length > 0 && (
        <ul id={errorId} class="field__errors" role="alert">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      <p id={hintId} class="field__hint">
        {props.canUpload ? t.images.formats : t.images.adminsOnly}
      </p>
    </div>
  );
}
