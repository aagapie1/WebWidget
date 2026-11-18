import { fireEvent, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test-utils.js';
import { PublishDialog } from './PublishDialog.js';

describe('PublishDialog (request 4)', () => {
  it('summarises the changed sections and sends the comment on confirm', () => {
    const onConfirm = vi.fn();
    renderWithI18n(
      <PublishDialog
        nextVersion={4}
        sections={['window', 'allowedOrigins']}
        busy={false}
        error={undefined}
        onConfirm={onConfirm}
        onCancel={() => undefined}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Publicați modificările?' });
    expect(dialog.textContent).toContain('Se creează versiunea 4.');
    const items = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toEqual(['Fereastră și culori', 'Domenii permise']);
    fireEvent.input(screen.getByLabelText('Comentariu (opțional)'), {
      target: { value: ' Culori noi ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Publică acum' }));
    expect(onConfirm).toHaveBeenCalledWith('Culori noi');
  });

  it('cancels and shows a publish error', () => {
    const onCancel = vi.fn();
    renderWithI18n(
      <PublishDialog
        nextVersion={2}
        sections={['texts']}
        busy={false}
        error="Publicarea nu a reușit."
        onConfirm={() => undefined}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('Publicarea nu a reușit.');
    fireEvent.click(screen.getByRole('button', { name: 'Anulează' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
