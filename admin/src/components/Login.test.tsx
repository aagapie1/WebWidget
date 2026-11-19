import { fireEvent, screen, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test-utils.js';
import { Login, type KnownOrg } from './Login.js';

const PILOT: KnownOrg = { org: 'pilot', kind: 'tenant', name: 'Primăria Pilot' };
const noOrgs = () => Promise.resolve([]);
/** The gateway knows "pilot"; the host belongs to `hostOrg` when set. */
const resolver =
  (hostOrg?: KnownOrg) =>
  (code?: string): Promise<KnownOrg | undefined> =>
    Promise.resolve(code === undefined ? hostOrg : code === 'pilot' ? PILOT : undefined);

describe('Login (E4b.1 UX 16)', () => {
  it('with an organisation in the link: its name, one button, no code field', async () => {
    const navigate = vi.fn();
    renderWithI18n(
      <Login
        linkOrg="pilot"
        storedOrg={undefined}
        error={undefined}
        returnTo="/admin/?tenant=pilot"
        navigate={navigate}
        loadOrgs={noOrgs}
        resolveOrg={resolver()}
      />,
    );
    expect(await screen.findByText('Primăria Pilot')).toBeTruthy();
    expect(
      screen.getByText('Veți fi redirecționat la pagina de autentificare a instituției.'),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Codul organizației')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continuă spre autentificare' }));
    expect(navigate).toHaveBeenCalledWith(
      '/admin/auth/login?org=pilot&returnTo=%2Fadmin%2F%3Ftenant%3Dpilot&locale=ro',
    );
  });

  it('knows the organisation from the host (ADMIN_ORG_HOSTS)', async () => {
    renderWithI18n(
      <Login
        linkOrg={undefined}
        storedOrg={undefined}
        error={undefined}
        returnTo="/admin/"
        loadOrgs={noOrgs}
        resolveOrg={resolver(PILOT)}
      />,
    );
    expect(await screen.findByText('Primăria Pilot')).toBeTruthy();
    expect(screen.queryByLabelText('Codul organizației')).toBeNull();
  });

  it('"Altă organizație?" opens the code field, focused', async () => {
    const navigate = vi.fn();
    renderWithI18n(
      <Login
        linkOrg="pilot"
        storedOrg={undefined}
        error={undefined}
        returnTo="/admin/"
        navigate={navigate}
        loadOrgs={noOrgs}
        resolveOrg={resolver()}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Altă organizație?' }));
    const input = await screen.findByLabelText<HTMLInputElement>('Codul organizației');
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
    fireEvent.input(input, { target: { value: 'Demo-Primarie' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(navigate).toHaveBeenCalledWith(
      '/admin/auth/login?org=demo-primarie&returnTo=%2Fadmin%2F&locale=ro',
    );
  });

  it('an unknown organisation in the link opens the code field with the reason', async () => {
    renderWithI18n(
      <Login
        linkOrg="nu-exista"
        storedOrg={undefined}
        error={undefined}
        returnTo="/admin/"
        loadOrgs={noOrgs}
        resolveOrg={resolver()}
      />,
    );
    const input = await screen.findByLabelText<HTMLInputElement>('Codul organizației');
    expect(input.value).toBe('nu-exista');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(
      document.getElementById((input.getAttribute('aria-describedby') ?? '').split(' ')[0] ?? '')
        ?.textContent,
    ).toMatch(/^Organizația nu este configurată/);
  });

  it('without any known organisation, the code field is the way in', async () => {
    renderWithI18n(
      <Login
        linkOrg={undefined}
        storedOrg={undefined}
        error={undefined}
        returnTo="/admin/"
        loadOrgs={noOrgs}
        resolveOrg={resolver()}
      />,
    );
    expect(await screen.findByLabelText('Codul organizației')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Altă organizație?' })).toBeNull();
  });

  it('explains login errors from the gateway', async () => {
    renderWithI18n(
      <Login
        linkOrg="pilot"
        storedOrg={undefined}
        error="no_role"
        returnTo="/admin/"
        loadOrgs={noOrgs}
        resolveOrg={resolver()}
      />,
    );
    expect((await screen.findByRole('alert')).textContent).toMatch(/^Contul nu face parte/);
  });

  it('offers the test organisations by name, each starting the sign-in (development)', async () => {
    const navigate = vi.fn();
    renderWithI18n(
      <Login
        linkOrg={undefined}
        storedOrg={undefined}
        error={undefined}
        returnTo="/admin/"
        navigate={navigate}
        loadOrgs={() => Promise.resolve([PILOT, { org: 'platform', kind: 'platform' }])}
        resolveOrg={resolver()}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Primăria Pilot (pilot)' }));
    expect(navigate).toHaveBeenCalledWith(
      '/admin/auth/login?org=pilot&returnTo=%2Fadmin%2F&locale=ro',
    );
    expect(
      screen.getByRole('button', { name: 'Administrarea platformei (platform)' }),
    ).toBeTruthy();
  });
});
