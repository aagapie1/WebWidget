import { useId, useRef, useState } from 'preact/hooks';
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
  /** Where the image appears (e.g. "Apare în antetul ferestrei."). */
  where?: string | undefined;
  /** Hide the field label when a surrounding control already names it. */
  hideLabel?: boolean;
}

/**
 * Image upload with a thumbnail and errors next to the field (request 6). The file input is
 * hidden (`hidden`) and opened by a real button: keyboard and screen readers use the button.
 * The server checks the real type and re-encodes; the size is checked here too, at once.
 */
export function ImageField(props: ImageFieldProps) {
  const { t } = useI18n();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>();
  const errors = [...(uploadError ? [uploadError] : []), ...(props.errors ?? [])];
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [errors.length > 0 ? errorId : '', hintId].filter(Boolean).join(' ');

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
    <div
      class={errors.length > 0 ? 'field field--invalid image-field' : 'field image-field'}
      role="group"
      aria-labelledby={`${id}-label`}
    >
      <span class={props.hideLabel ? 'visually-hidden' : 'field__label'} id={`${id}-label`}>
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
            <button
              type="button"
              class="button"
              aria-describedby={describedBy}
              aria-disabled={busy ? 'true' : undefined}
              onClick={() => {
                if (!busy) input.current?.click();
              }}
            >
              {busy ? t.images.uploading : props.value ? t.images.replace : t.images.upload}
            </button>
          )}
          <input
            ref={input}
            id={id}
            type="file"
            hidden
            accept={ACCEPT}
            disabled={!props.canUpload || busy}
            aria-labelledby={`${id}-label`}
            aria-describedby={describedBy}
            aria-invalid={errors.length > 0}
            onChange={(event) => {
              const element = event.currentTarget;
              void choose(element.files?.[0]).then(() => {
                element.value = '';
              });
            }}
          />
          {props.canUpload && props.value && (
            <button
              type="button"
              class="button"
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
        {props.where && (
          <>
            <strong>{props.where}</strong>{' '}
          </>
        )}
        {props.canUpload ? t.images.formats : t.images.adminsOnly}
      </p>
    </div>
  );
}
