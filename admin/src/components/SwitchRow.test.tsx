import { fireEvent, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { Info } from '../icons.js';
import { renderWithI18n } from '../test-utils.js';
import { SwitchRow } from './SwitchRow.js';

describe('SwitchRow', () => {
  it('is a named, described switch; its settings show only when on', () => {
    const onChange = vi.fn();
    const { rerender } = renderWithI18n(
      <SwitchRow
        icon={Info}
        title="Afișează mesajul"
        description="O singură frază."
        checked={false}
        onChange={onChange}
      >
        <p>Setări</p>
      </SwitchRow>,
    );
    const toggle = screen.getByRole('switch', { name: 'Afișează mesajul' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(
      document.getElementById(toggle.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toBe('O singură frază.');
    expect(screen.queryByText('Setări')).toBeNull();
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(
      <SwitchRow
        icon={Info}
        title="Afișează mesajul"
        description="O singură frază."
        checked
        onChange={onChange}
      >
        <p>Setări</p>
      </SwitchRow>,
    );
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Setări')).toBeTruthy();
  });
});
