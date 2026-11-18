import { fireEvent, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test-utils.js';
import { OptionGrid } from './OptionGrid.js';

describe('OptionGrid', () => {
  const options = [
    { value: 'chat', label: 'Conversație', visual: <span>c</span> },
    { value: 'help', label: 'Semn de întrebare', visual: <span>?</span> },
  ] as const;

  it('is a labelled radio group with the selected tile highlighted', () => {
    const onChange = vi.fn();
    renderWithI18n(
      <OptionGrid legend="Iconul butonului" value="chat" options={options} onChange={onChange} />,
    );
    const group = screen.getByRole('group', { name: 'Iconul butonului' });
    const radios = screen.getAllByRole('radio');
    expect(group).toBeTruthy();
    expect(radios).toHaveLength(2);
    expect(screen.getByRole('radio', { name: 'Conversație' })).toHaveProperty('checked', true);
    expect(screen.getByText('Conversație').closest('.tile')?.classList).toContain('tile--selected');
    fireEvent.click(screen.getByRole('radio', { name: 'Semn de întrebare' }));
    expect(onChange).toHaveBeenCalledWith('help');
  });
});
