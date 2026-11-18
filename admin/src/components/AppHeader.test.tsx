import { fireEvent, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test-utils.js';
import { AppHeader } from './AppHeader.js';

const user = { name: 'Ana Popescu', role: 'widget-admin' as const, org: 'pilot' };

describe('AppHeader', () => {
  it("shows the client's assistant and a user menu that Escape closes", () => {
    const onLogout = vi.fn();
    renderWithI18n(
      <AppHeader
        assistantName="Asistentul Primăriei"
        clientName="Primăria Test"
        user={user}
        onLocale={vi.fn()}
        onLogout={onLogout}
      />,
    );
    expect(screen.getByText('Asistentul Primăriei')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Meniul utilizatorului: Ana Popescu' });
    expect(button.textContent).toContain('AP');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const panel = document.getElementById('user-menu-panel');
    expect(panel?.textContent).toContain('Administrator');
    expect(panel?.textContent).toContain('pilot');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.getElementById('user-menu-panel')).toBeNull();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Deconectare' }));
    expect(onLogout).toHaveBeenCalled();
  });

  it('switches the language; the button names start with the visible code', () => {
    const onLocale = vi.fn();
    renderWithI18n(<AppHeader assistantName="A" clientName="C" onLocale={onLocale} />);
    const english = screen.getByRole('button', { name: /^EN/ });
    expect(screen.getByRole('button', { name: /^RO/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(english);
    expect(onLocale).toHaveBeenCalledWith('en');
  });

  it('lets the super-admin switch clients', () => {
    const onTenant = vi.fn();
    renderWithI18n(
      <AppHeader
        assistantName="A"
        clientName="C"
        tenants={['demo-primarie', 'pilot']}
        tenant="pilot"
        onTenant={onTenant}
        onLocale={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Client' }), {
      target: { value: 'demo-primarie' },
    });
    expect(onTenant).toHaveBeenCalledWith('demo-primarie');
  });
});
