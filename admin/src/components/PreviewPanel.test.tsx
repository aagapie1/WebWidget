import { fireEvent, screen, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test-utils.js';
import { desktopCanvas, fitScale, KEEP_ALIVE_MS, PHONE, PreviewPanel } from './PreviewPanel.js';

describe('PreviewPanel', () => {
  it('reloads the preview after each saved draft, reusing the short-lived token', async () => {
    const createToken = vi.fn(() => Promise.resolve({ url: '/admin/preview?id=pilot--p-abc' }));
    const { rerender } = renderWithI18n(<PreviewPanel revision={0} createToken={createToken} />);
    const frame = await screen.findByTitle('Previzualizarea widget-ului cu ciorna');
    expect(frame.getAttribute('src')).toBe(
      '/admin/preview?id=pilot--p-abc&locale=ro&show=window&r=0',
    );
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
    expect(document.querySelector('.preview__canvas--mobile')).toBeTruthy();
    const frame = screen.getByTitle<HTMLIFrameElement>('Previzualizarea widget-ului cu ciorna');
    expect([frame.style.width, frame.style.height]).toEqual(['390px', '844px']);
  });

  it('says when the preview is unavailable', async () => {
    renderWithI18n(
      <PreviewPanel revision={0} createToken={() => Promise.reject(new Error('x'))} />,
    );
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Previzualizarea nu este disponibilă.',
    );
  });

  it('keeps the preview token alive while the panel is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const keepAlive = vi.fn(() => Promise.resolve());
      renderWithI18n(
        <PreviewPanel
          revision={0}
          createToken={() => Promise.resolve({ url: '/admin/preview?id=pilot--p-abc' })}
          keepAlive={keepAlive}
        />,
      );
      await screen.findByTitle('Previzualizarea widget-ului cu ciorna');
      await vi.advanceTimersByTimeAsync(KEEP_ALIVE_MS);
      expect(keepAlive).toHaveBeenCalledWith('pilot--p-abc');
      await vi.advanceTimersByTimeAsync(KEEP_ALIVE_MS);
      expect(keepAlive).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts in the state of the edited section and follows it without reloading', async () => {
    const createToken = () => Promise.resolve({ url: '/admin/preview?id=pilot--p-abc' });
    const { rerender } = renderWithI18n(
      <PreviewPanel revision={0} createToken={createToken} show="launcher" />,
    );
    const frame = await screen.findByTitle<HTMLIFrameElement>(
      'Previzualizarea widget-ului cu ciorna',
    );
    expect(frame.getAttribute('src')).toBe(
      '/admin/preview?id=pilot--p-abc&locale=ro&show=launcher&r=0',
    );
    const post = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    rerender(<PreviewPanel revision={0} createToken={createToken} show="proactive" />);
    expect(post).toHaveBeenCalledWith(
      { source: 'chat-widget', v: 1, type: 'preview', show: 'proactive' },
      window.location.origin,
    );
    // Same document: the change did not reload the frame.
    expect(frame.getAttribute('src')).toMatch(/show=launcher/);
  });
});

describe('real size and scaling', () => {
  it('sizes the desktop canvas for the configured window, launcher and offsets', () => {
    expect(desktopCanvas({ width: 380, height: 640, offsetX: 24, offsetY: 24 })).toEqual({
      width: 560,
      height: 772,
    });
    expect(desktopCanvas({ width: 520, height: 800, offsetX: 40, offsetY: 100 })).toEqual({
      width: 640,
      height: 1008,
    });
  });

  it('scales down to fit, never up, and keeps the proportions', () => {
    expect(fitScale({ width: 560, height: 772 }, { width: 1120, height: 1544 })).toBe(1);
    expect(fitScale({ width: 560, height: 772 }, { width: 560, height: 386 })).toBe(0.5);
    expect(fitScale(PHONE, { width: 195, height: 2000 })).toBe(0.5);
  });
});
