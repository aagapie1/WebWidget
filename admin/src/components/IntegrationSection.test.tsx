import { fireEvent, screen, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test-utils.js';
import { cspFor, embedSnippet, IntegrationSection } from './IntegrationSection.js';

const GATEWAY = 'https://asistent.example.ro';

describe('IntegrationSection', () => {
  it('builds the embed line and the CSP additions from the server configuration', () => {
    expect(embedSnippet(GATEWAY, 'pilot', 'ro')).toBe(
      '<script src="https://asistent.example.ro/w/loader.js" data-tenant="pilot" async></script>',
    );
    expect(embedSnippet(GATEWAY, 'pilot', 'en')).toContain(' data-locale="en" ');
    expect(cspFor(GATEWAY)).toEqual([
      `script-src ${GATEWAY}`,
      `frame-src ${GATEWAY}`,
      `connect-src ${GATEWAY}`,
      `img-src ${GATEWAY}`,
    ]);
  });

  it('marks the domains item ✓ or ⚠, named for screen readers, with the reason', () => {
    const render = (domainsStatus: 'ok' | 'missing' | 'invalid', origins: string[]) =>
      renderWithI18n(
        <IntegrationSection
          tenant="pilot"
          gatewayOrigin={GATEWAY}
          origins={origins}
          domainsStatus={domainsStatus}
          checkInstallations={vi.fn()}
        />,
      );
    const ok = render('ok', ['https://www.pilot.ro']);
    const okItem = ok.container.querySelector('.checklist__item--ok');
    expect(okItem?.textContent).toMatch(/^✓\s*În regulă: /);
    ok.unmount();

    const missing = render('missing', []);
    const warn = missing.container.querySelector('.checklist__item--warn');
    expect(warn?.textContent).toMatch(/^⚠\s*De verificat: /);
    expect(warn?.textContent).toContain('Nu există niciun domeniu permis');
    expect(missing.container.querySelector('.checklist__item--ok')).toBeNull();
    missing.unmount();

    const invalid = render('invalid', ['http://www.pilot.ro']);
    expect(invalid.container.querySelector('.checklist__item--warn')?.textContent).toContain(
      'Unele domenii permise au erori.',
    );
  });

  it('copies the code (updated live with the language) and confirms politely', async () => {
    const copy = vi.fn(() => Promise.resolve());
    renderWithI18n(
      <IntegrationSection
        tenant="pilot"
        gatewayOrigin={GATEWAY}
        origins={['https://www.pilot.ro']}
        checkInstallations={vi.fn()}
        copy={copy}
      />,
    );
    fireEvent.click(screen.getByLabelText('Engleză (data-locale="en")'));
    fireEvent.click(screen.getByRole('button', { name: 'Copiază' }));
    expect(copy).toHaveBeenCalledWith(embedSnippet(GATEWAY, 'pilot', 'en'));
    await waitFor(() => {
      expect(screen.getByText('Codul a fost copiat.')).toBeTruthy();
    });
    expect(screen.getByText(/Acum: https:\/\/www\.pilot\.ro/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Domenii permise' }).getAttribute('href')).toBe(
      '#domains',
    );
  });

  it('reports where the widget was detected', async () => {
    renderWithI18n(
      <IntegrationSection
        tenant="pilot"
        gatewayOrigin={GATEWAY}
        origins={['https://www.pilot.ro', 'https://intranet.pilot.ro']}
        checkInstallations={() =>
          Promise.resolve({
            installations: [
              { origin: 'https://www.pilot.ro', lastSeen: '2026-11-18T10:05:00.000Z' },
              { origin: 'https://intranet.pilot.ro', lastSeen: null },
            ],
          })
        }
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Verifică instalarea' }));
    expect(
      await screen.findByText(/^Widget detectat pe https:\/\/www\.pilot\.ro la /),
    ).toBeTruthy();
    expect(screen.getByText('Încă nu a fost detectat pe https://intranet.pilot.ro')).toBeTruthy();
  });
});
