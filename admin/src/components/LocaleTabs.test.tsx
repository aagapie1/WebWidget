import { fireEvent, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '../test-utils.js';
import { LocaleTabs } from './LocaleTabs.js';

const panel = (locale: string) => <p>Panou {locale}</p>;

describe('LocaleTabs', () => {
  it('shows one language at a time; arrows, Home and End switch and focus the tab', () => {
    renderWithI18n(<LocaleTabs label="Limba textelor">{panel}</LocaleTabs>);
    const list = screen.getByRole('tablist', { name: 'Limba textelor' });
    const ro = screen.getByRole('tab', { name: 'Română' });
    const en = screen.getByRole('tab', { name: 'Engleză' });
    expect(ro.getAttribute('aria-selected')).toBe('true');
    expect(en.getAttribute('tabindex')).toBe('-1');
    expect(screen.getByRole('tabpanel').textContent).toBe('Panou ro');

    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(en.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(en);
    expect(screen.getByRole('tabpanel', { name: 'Engleză' }).textContent).toBe('Panou en');
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(ro.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(list, { key: 'End' });
    expect(en.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(list, { key: 'Home' });
    expect(ro.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(en);
    expect(screen.getByRole('tabpanel').textContent).toBe('Panou en');
  });

  it('shows the errors of each language on its tab', () => {
    renderWithI18n(
      <LocaleTabs label="Limba textelor" errors={{ en: 2 }}>
        {panel}
      </LocaleTabs>,
    );
    expect(screen.getByRole('tab', { name: /^Engleză.*2 erori/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Română' })).toBeTruthy();
  });
});
