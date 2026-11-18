import { fireEvent, screen, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api.js';
import { renderWithI18n } from '../test-utils.js';
import { ImageField, MAX_UPLOAD_BYTES } from './ImageField.js';

const pick = (input: HTMLElement, file: File) => {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
};

describe('ImageField (request 6)', () => {
  it('uploads, then shows the thumbnail served by the admin API', async () => {
    const onChange = vi.fn();
    const upload = vi.fn(() => Promise.resolve({ file: 'logo-abc.png' }));
    const { rerender } = renderWithI18n(
      <ImageField
        label="Logo"
        tenant="pilot"
        value={undefined}
        canUpload
        upload={upload}
        onChange={onChange}
      />,
    );
    pick(screen.getByLabelText('Logo'), new File(['x'], 'logo.png', { type: 'image/png' }));
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('logo-abc.png');
    });
    rerender(
      <ImageField
        label="Logo"
        tenant="pilot"
        value="logo-abc.png"
        canUpload
        upload={upload}
        onChange={onChange}
      />,
    );
    const image = screen.getByRole('img', { name: 'Previzualizare: Logo' });
    expect(image.getAttribute('src')).toBe('/admin/api/tenants/pilot/assets/logo-abc.png');
  });

  it('shows the server refusal next to the field (SVG, fake image)', async () => {
    const upload = vi.fn(() => Promise.reject(new ApiError(415, 'unsupported_type')));
    renderWithI18n(
      <ImageField
        label="Logo"
        tenant="pilot"
        value={undefined}
        canUpload
        upload={upload}
        onChange={() => undefined}
      />,
    );
    const input = screen.getByLabelText('Logo');
    pick(input, new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('SVG nu este acceptat');
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('refuses files over 512 KB without uploading them', async () => {
    const upload = vi.fn();
    renderWithI18n(
      <ImageField
        label="Logo"
        tenant="pilot"
        value={undefined}
        canUpload
        upload={upload}
        onChange={() => undefined}
      />,
    );
    pick(
      screen.getByLabelText('Logo'),
      new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], 'big.png', { type: 'image/png' }),
    );
    expect((await screen.findByRole('alert')).textContent).toContain('512 KB');
    expect(upload).not.toHaveBeenCalled();
  });

  it('tells editors that only administrators upload images', () => {
    renderWithI18n(
      <ImageField
        label="Logo"
        tenant="pilot"
        value="logo.png"
        canUpload={false}
        upload={vi.fn()}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText('Doar administratorii pot încărca imagini.')).toBeTruthy();
    expect(screen.getByLabelText('Logo').hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('img')).toBeTruthy();
  });
});
