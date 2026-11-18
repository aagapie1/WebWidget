import { fireEvent, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test-utils.js';
import { SaveStatus } from './SaveStatus.js';

describe('SaveStatus (request 5)', () => {
  it('is a polite live region with the current state', () => {
    const { rerender } = renderWithI18n(
      <SaveStatus state={{ kind: 'pending' }} onRetry={() => undefined} />,
    );
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('Modificări nesalvate…');
    rerender(<SaveStatus state={{ kind: 'saving' }} onRetry={() => undefined} />);
    expect(screen.getByRole('status').textContent).toBe('Se salvează ciorna…');
    rerender(<SaveStatus state={{ kind: 'published', version: 4 }} onRetry={() => undefined} />);
    expect(screen.getByRole('status').textContent).toBe('Versiunea 4 a fost publicată.');
  });

  it('shows the save time and offers a retry after an error', () => {
    const onRetry = vi.fn();
    const { rerender } = renderWithI18n(
      <SaveStatus state={{ kind: 'saved', at: '2026-11-18T10:05:00.000Z' }} onRetry={onRetry} />,
    );
    expect(screen.getByRole('status').textContent).toMatch(/^Ciornă salvată la \d{2}:\d{2}$/);
    rerender(<SaveStatus state={{ kind: 'error' }} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Încearcă din nou' }));
    expect(onRetry).toHaveBeenCalled();
  });
});
