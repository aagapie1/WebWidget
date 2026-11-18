import { fireEvent, screen, within } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test-utils.js';
import { Sidebar } from './Sidebar.js';

describe('Sidebar', () => {
  it('marks the current area, errors and unpublished changes', () => {
    renderWithI18n(
      <Sidebar
        area="aspect"
        changed={new Set(['texts', 'domains'])}
        errors={{ domains: 1 }}
        onArea={vi.fn()}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Zone de configurare' });
    expect(within(nav).getByRole('link', { name: 'Aspect' }).getAttribute('aria-current')).toBe(
      'page',
    );
    // Errors win over the changed dot; both are named for screen readers.
    expect(within(nav).getByRole('link', { name: /^Domenii permise.*1 eroare/ })).toBeTruthy();
    expect(
      within(nav).getByRole('link', { name: /^Texte și întrebări.*modificări nepublicate/ }),
    ).toBeTruthy();
  });

  it('navigates to an area, and to the subsections of Aspect', () => {
    const onArea = vi.fn();
    renderWithI18n(<Sidebar area="aspect" changed={new Set()} errors={{}} onArea={onArea} />);
    fireEvent.click(screen.getByRole('link', { name: 'Culori' }));
    expect(onArea).toHaveBeenLastCalledWith('aspect', 'colors');
    fireEvent.click(screen.getByRole('link', { name: 'Integrare pe site' }));
    expect(onArea).toHaveBeenLastCalledWith('integration');
  });

  it('shows only the areas the user may see', () => {
    renderWithI18n(
      <Sidebar
        area="texts"
        changed={new Set()}
        errors={{}}
        visible={['aspect', 'texts']}
        onArea={vi.fn()}
      />,
    );
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.queryByRole('link', { name: 'Culori' })).toBeNull();
  });
});
