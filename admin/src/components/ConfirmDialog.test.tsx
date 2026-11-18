import { fireEvent, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test-utils.js';
import { ConfirmDialog } from './ConfirmDialog.js';

describe('ConfirmDialog', () => {
  it('names itself, explains the consequence and confirms or cancels', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderWithI18n(
      <ConfirmDialog
        title="Renunțați la modificări?"
        body="Ciorna se șterge."
        confirmLabel="Renunță la modificări"
        cancelLabel="Anulează"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Renunțați la modificări?' });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Anulează' }));
    expect(onCancel).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Renunță la modificări' }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('ignores a second confirmation while busy', () => {
    const onConfirm = vi.fn();
    renderWithI18n(
      <ConfirmDialog
        title="T"
        body="B"
        confirmLabel="Da"
        cancelLabel="Nu"
        busy
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Da' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
