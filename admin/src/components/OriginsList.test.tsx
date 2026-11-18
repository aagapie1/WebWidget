import { fireEvent, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test-utils.js';
import { OriginsList } from './OriginsList.js';

const noErrors = () => undefined;

describe('OriginsList', () => {
  it('edits one domain per row and adds a row with the focus in it', () => {
    const onChange = vi.fn();
    renderWithI18n(
      <OriginsList origins={['https://www.a.ro']} errorsAt={noErrors} onChange={onChange} />,
    );
    expect(screen.getByLabelText<HTMLInputElement>('Domeniul 1').value).toBe('https://www.a.ro');
    fireEvent.click(screen.getByRole('button', { name: 'Adaugă domeniu' }));
    const second = screen.getByLabelText<HTMLInputElement>('Domeniul 2');
    expect(document.activeElement).toBe(second);
    // An empty row is not sent.
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.input(second, { target: { value: ' https://www.b.ro ' } });
    expect(onChange).toHaveBeenLastCalledWith(['https://www.a.ro', 'https://www.b.ro']);
  });

  it('shows the errors on their own row (empty rows do not shift them)', () => {
    renderWithI18n(
      <OriginsList
        origins={['https://www.a.ro', 'http://www.b.ro']}
        errorsAt={(index) => (index === 1 ? ['Folosiți https://'] : undefined)}
        onChange={vi.fn()}
      />,
    );
    const first = screen.getByLabelText('Domeniul 1');
    const second = screen.getByLabelText('Domeniul 2');
    expect(first.getAttribute('aria-invalid')).toBe('false');
    expect(second.getAttribute('aria-invalid')).toBe('true');
    const describedBy = second.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy.split(' ')[0] ?? '')?.textContent).toBe(
      'Folosiți https://',
    );
  });

  it('asks before removing a domain: the assistant stops there once published', () => {
    const onChange = vi.fn();
    renderWithI18n(
      <OriginsList
        origins={['https://www.a.ro', 'https://www.b.ro']}
        errorsAt={noErrors}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Elimină domeniul 2 (https://www.b.ro)' }));
    const dialog = screen.getByRole('dialog', { name: 'Eliminați domeniul?' });
    expect(dialog.textContent).toContain(
      'Asistentul se va opri pe https://www.b.ro după publicare.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Anulează' }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Elimină domeniul 2 (https://www.b.ro)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elimină domeniul' }));
    expect(onChange).toHaveBeenLastCalledWith(['https://www.a.ro']);
    expect(screen.queryByLabelText('Domeniul 2')).toBeNull();
  });

  it('removes an empty row without asking', () => {
    renderWithI18n(<OriginsList origins={[]} errorsAt={noErrors} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Adaugă domeniu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elimină domeniul 2' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByLabelText('Domeniul 2')).toBeNull();
  });
});
