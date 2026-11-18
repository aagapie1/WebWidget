import { fireEvent, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test-utils.js';
import { ColorField } from './ColorField.js';

describe('ColorField, automatic colors (E4b.1 UX 9)', () => {
  it('shows the computed value and can keep it', () => {
    const onChange = vi.fn();
    renderWithI18n(
      <ColorField
        label="Linkuri"
        value={undefined}
        fallback="#267e36"
        automatic
        onChange={onChange}
      />,
    );
    expect(screen.getByText('Automat: #267e36')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fixează valoarea: Linkuri' }));
    expect(onChange).toHaveBeenCalledWith('#267e36');
  });

  it('goes back to automatic once a value is set', () => {
    const onChange = vi.fn();
    renderWithI18n(
      <ColorField
        label="Linkuri"
        value="#123456"
        fallback="#267e36"
        automatic
        onChange={onChange}
      />,
    );
    expect(screen.queryByText(/^Automat:/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Revino la automat: Linkuri' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('a color with a fixed default offers no "keep" button', () => {
    renderWithI18n(
      <ColorField label="Fundal" value={undefined} fallback="#ffffff" onChange={vi.fn()} />,
    );
    expect(screen.getByText('Implicit: #ffffff')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
