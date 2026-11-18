import { fireEvent, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test-utils.js';
import { PublishBar } from './PublishBar.js';

const ready = { canPublish: true, errorCount: 0, hasChanges: true, saving: false, conflict: false };

describe('PublishBar (request 2)', () => {
  it('is disabled for widget-editor with a visible, linked explanation', () => {
    const onPublish = vi.fn();
    renderWithI18n(<PublishBar {...ready} canPublish={false} onPublish={onPublish} />);
    const button = screen.getByRole('button', { name: /^Publică/ });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    const reason = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(reason?.textContent).toMatch(/^Doar administratorii \(rolul widget-admin\) pot publica/);
    fireEvent.click(button);
    expect(onPublish).not.toHaveBeenCalled();
  });

  it('explains every other reason, in priority order', () => {
    const { rerender } = renderWithI18n(
      <PublishBar {...ready} errorCount={2} onPublish={() => undefined} />,
    );
    expect(screen.getByText('Corectați cele 2 erori înainte de publicare.')).toBeTruthy();
    rerender(<PublishBar {...ready} conflict onPublish={() => undefined} />);
    expect(screen.getByText('Rezolvați întâi conflictul ciornei.')).toBeTruthy();
    rerender(<PublishBar {...ready} saving onPublish={() => undefined} />);
    expect(screen.getByText('Așteptați salvarea ciornei.')).toBeTruthy();
    rerender(<PublishBar {...ready} hasChanges={false} onPublish={() => undefined} />);
    expect(screen.getByText('Nu există modificări de publicat.')).toBeTruthy();
  });

  it('publishes when nothing blocks it', () => {
    const onPublish = vi.fn();
    renderWithI18n(<PublishBar {...ready} onPublish={onPublish} />);
    const button = screen.getByRole('button', { name: /^Publică/ });
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    fireEvent.click(button);
    expect(onPublish).toHaveBeenCalled();
  });
});
