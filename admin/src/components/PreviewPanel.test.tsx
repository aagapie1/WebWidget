import { fireEvent, screen, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test-utils.js';
import { PreviewPanel } from './PreviewPanel.js';

describe('PreviewPanel', () => {
  it('reloads the preview after each saved draft, reusing the short-lived token', async () => {
    const createToken = vi.fn(() => Promise.resolve({ url: '/admin/preview?id=pilot--p-abc' }));
    const { rerender } = renderWithI18n(<PreviewPanel revision={0} createToken={createToken} />);
    const frame = await screen.findByTitle('Previzualizarea widget-ului cu ciorna');
    expect(frame.getAttribute('src')).toBe('/admin/preview?id=pilot--p-abc&locale=ro&r=0');
    rerender(<PreviewPanel revision={1} createToken={createToken} />);
    await waitFor(() => {
      expect(
        screen.getByTitle('Previzualizarea widget-ului cu ciorna').getAttribute('src'),
      ).toMatch(/&r=1$/);
    });
    expect(createToken).toHaveBeenCalledTimes(1);
  });

  it('switches between desktop and phone width', async () => {
    renderWithI18n(
      <PreviewPanel
        revision={0}
        createToken={() => Promise.resolve({ url: '/admin/preview?id=x' })}
      />,
    );
    await screen.findByTitle('Previzualizarea widget-ului cu ciorna');
    const phone = screen.getByRole('button', { name: 'Telefon' });
    fireEvent.click(phone);
    expect(phone.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.preview__stage--mobile')).toBeTruthy();
  });

  it('says when the preview is unavailable', async () => {
    renderWithI18n(
      <PreviewPanel revision={0} createToken={() => Promise.reject(new Error('x'))} />,
    );
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Previzualizarea nu este disponibilă.',
    );
  });
});
