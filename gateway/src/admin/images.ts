import { createHash } from 'node:crypto';
import sharp, { type OutputInfo } from 'sharp';

export type ImageFormat = 'png' | 'jpeg' | 'webp';

const CONTENT_TYPE: Record<ImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
const EXTENSION: Record<ImageFormat, string> = { png: 'png', jpeg: 'jpg', webp: 'webp' };

export const IMAGE_LIMITS = {
  /** Upload size limit (spec §5.4: configurable, 512 KB by default). */
  maxUploadBytes: 512 * 1024,
  /** Decompression bomb guard: refuse images with more pixels before decoding them. */
  maxInputPixels: 4096 * 4096,
  /** Longest side after re-encoding (logos, icons and avatars are small). */
  maxSide: 512,
  /** Stored size limit: the same bound as served tenant images. */
  maxOutputBytes: 200 * 1024,
};

/** The real type from the magic bytes (spec §5.4), never from the name or Content-Type. */
export function detectImageFormat(bytes: Buffer): ImageFormat | undefined {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return undefined;
}

export type ImageError = 'too_large' | 'unsupported_type' | 'invalid_image';

export interface ProcessedImage {
  /** Content-addressed: `<base>-<hash>.<ext>`; a new upload never replaces a published image. */
  name: string;
  bytes: Buffer;
  contentType: string;
  hash: string;
  width: number;
  height: number;
}

/** A safe base for the stored name, from the uploaded file name (letters, digits, dashes). */
export function nameBase(fileName: string | undefined): string {
  const base = ((fileName ?? '').split(/[\\/]/).pop() ?? '')
    .replace(/\.[^.]*$/, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'image';
}

/**
 * Validates and re-encodes an uploaded image (ADR 008): PNG, JPEG or WebP only (no SVG), checked
 * from the magic bytes and again by the decoder; EXIF orientation applied, then every metadata
 * block and any trailing content dropped by re-encoding; size bounded.
 */
export async function processImage(
  input: Buffer,
  fileName: string | undefined,
  limits = IMAGE_LIMITS,
): Promise<{ ok: true; image: ProcessedImage } | { ok: false; error: ImageError }> {
  if (input.length > limits.maxUploadBytes) return { ok: false, error: 'too_large' };
  const format = detectImageFormat(input);
  if (!format) return { ok: false, error: 'unsupported_type' };

  let output: { data: Buffer; info: OutputInfo };
  try {
    const image = sharp(input, { limitInputPixels: limits.maxInputPixels, failOn: 'error' });
    const metadata = await image.metadata();
    // The decoder must agree with the magic bytes (a polyglot file is refused).
    if (metadata.format !== format) return { ok: false, error: 'unsupported_type' };
    const pipeline = image.rotate().resize({
      width: limits.maxSide,
      height: limits.maxSide,
      fit: 'inside',
      withoutEnlargement: true,
    });
    const encoded =
      format === 'png'
        ? pipeline.png({ compressionLevel: 9 })
        : format === 'jpeg'
          ? pipeline.jpeg({ quality: 85, mozjpeg: true })
          : pipeline.webp({ quality: 85 });
    output = await encoded.toBuffer({ resolveWithObject: true });
  } catch {
    return { ok: false, error: 'invalid_image' };
  }
  if (output.data.length > limits.maxOutputBytes) return { ok: false, error: 'too_large' };

  const hash = createHash('sha256').update(output.data).digest('hex');
  return {
    ok: true,
    image: {
      name: `${nameBase(fileName)}-${hash.slice(0, 12)}.${EXTENSION[format]}`,
      bytes: output.data,
      contentType: CONTENT_TYPE[format],
      hash,
      width: output.info.width,
      height: output.info.height,
    },
  };
}
