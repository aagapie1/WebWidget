import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { diff, editableView, mergeServerFields } from '../src/admin/editable.js';
import { detectImageFormat, IMAGE_LIMITS, nameBase, processImage } from '../src/admin/images.js';

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#3a36d0' } });

describe('image uploads (spec §5.4, ADR 008)', () => {
  it('detects the real type from the magic bytes', async () => {
    expect(detectImageFormat(await solid(4, 4).png().toBuffer())).toBe('png');
    expect(detectImageFormat(await solid(4, 4).jpeg().toBuffer())).toBe('jpeg');
    expect(detectImageFormat(await solid(4, 4).webp().toBuffer())).toBe('webp');
    expect(detectImageFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(
      undefined,
    );
    expect(detectImageFormat(Buffer.from('GIF89a'))).toBeUndefined();
  });

  it('refuses SVG and a file with a fake image extension', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect(await processImage(svg, 'logo.svg')).toEqual({ ok: false, error: 'unsupported_type' });
    expect(await processImage(Buffer.from('MZ not an image'), 'logo.png')).toEqual({
      ok: false,
      error: 'unsupported_type',
    });
    // Right magic bytes, broken content.
    const fake = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('garbage'),
    ]);
    expect(await processImage(fake, 'logo.png')).toEqual({ ok: false, error: 'invalid_image' });
  });

  it('names the file after its real type, whatever the uploaded name says', async () => {
    const result = await processImage(await solid(8, 8).webp().toBuffer(), 'Stemă Primăria.png');
    expect(result.ok && result.image.name).toMatch(/^stema-primaria-[0-9a-f]{12}\.webp$/);
    expect(result.ok && result.image.contentType).toBe('image/webp');
  });

  it('removes EXIF and trailing content by re-encoding, and bounds the size', async () => {
    const withExif = await solid(1200, 600)
      .jpeg()
      .withExif({ IFD0: { Artist: 'Secret Person', ImageDescription: 'GPS here' } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const input = Buffer.concat([withExif, Buffer.from('TRAILING-PAYLOAD')]);

    const result = await processImage(input, 'photo.jpg');
    if (!result.ok) throw new Error(result.error);
    const metadata = await sharp(result.image.bytes).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.format).toBe('jpeg');
    expect([result.image.width, result.image.height]).toEqual([512, 256]);
    expect(result.image.bytes.includes('TRAILING-PAYLOAD')).toBe(false);
    expect(result.image.bytes.includes('Secret Person')).toBe(false);
  });

  it('refuses oversized uploads and decompression bombs before decoding', async () => {
    const big = Buffer.concat([
      await solid(4, 4).png().toBuffer(),
      Buffer.alloc(IMAGE_LIMITS.maxUploadBytes),
    ]);
    expect(await processImage(big, 'big.png')).toEqual({ ok: false, error: 'too_large' });

    // A tiny file announcing a huge canvas.
    const bomb = await solid(5000, 5000).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.length).toBeLessThan(IMAGE_LIMITS.maxUploadBytes);
    expect(await processImage(bomb, 'bomb.png')).toEqual({ ok: false, error: 'invalid_image' });
  });

  it('builds safe name bases', () => {
    expect(nameBase('../../etc/passwd')).toBe('passwd');
    expect(nameBase('C:\\Users\\x\\Logo Nou.PNG')).toBe('logo-nou');
    expect(nameBase(undefined)).toBe('image');
    expect(nameBase('...')).toBe('image');
  });
});

describe('editable configuration', () => {
  const stored = {
    schemaVersion: 1,
    id: 'pilot',
    enabled: true,
    difyBaseUrl: '${DIFY_BASE_URL}',
    difyApiKeyEnv: 'DIFY_API_KEY_PILOT',
    name: 'Pilot',
    theme: { accent: '#3a36d0' },
  };

  it('never exposes or accepts the server fields', () => {
    expect(editableView(stored)).toEqual({ name: 'Pilot', theme: { accent: '#3a36d0' } });
    const merged = mergeServerFields(
      { name: 'Nou', difyApiKeyEnv: 'OTHER_KEY', id: 'demo-primarie', enabled: false },
      stored,
    );
    expect(merged).toEqual({ ...stored, name: 'Nou', theme: undefined });
    expect(merged).not.toHaveProperty('theme');
  });

  it('lists leaf changes for the audit log', () => {
    expect(
      diff(
        { name: 'A', theme: { accent: '#000000' }, allowedOrigins: ['https://a.ro'] },
        { name: 'A', theme: { accent: '#111111', link: '#222222' }, allowedOrigins: [] },
      ),
    ).toEqual([
      { path: 'allowedOrigins', before: ['https://a.ro'], after: [] },
      { path: 'theme.accent', before: '#000000', after: '#111111' },
      { path: 'theme.link', after: '#222222' },
    ]);
  });
});
