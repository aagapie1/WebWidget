import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type AuditEventView, type AuditPage, type AuditQuery } from '../api.js';
import { fakeApi, renderWithI18n } from '../test-utils.js';
import { AuditLog, formatRomaniaTime, romaniaMidnight, toQuery } from './AuditLog.js';

const event = (overrides: Partial<AuditEventView> = {}): AuditEventView => ({
  id: 1,
  seq: 1,
  at: '2026-11-20T08:30:00.000Z',
  chain: 'pilot',
  tenant: 'pilot',
  actor: {
    kind: 'user',
    subject: 'kc-1',
    name: 'Ana Pop',
    email: 'ana@pilot.ro',
    role: 'widget-admin',
    org: 'pilot',
    source: 'local',
  },
  context: { ip: '10.0.0.7', userAgent: 'Firefox', sessionHash: 'abc', requestId: 'req-1' },
  action: 'publish',
  section: 'allowedOrigins, theme',
  result: 'success',
  version: 4,
  sensitive: true,
  details: {
    comment: 'domenii noi',
    changes: [
      { path: 'allowedOrigins', before: ['https://a.ro'], after: ['https://a.ro', 'https://b.ro'] },
      { path: 'theme.accent', before: '#111111', after: '#222222' },
    ],
  },
  source: 'admin',
  hash: 'h1',
  ...overrides,
});

const page = (events: AuditEventView[], nextBefore?: number): Promise<AuditPage> =>
  Promise.resolve({ chain: 'pilot', events, ...(nextBefore ? { nextBefore } : {}) });

describe('AuditLog', () => {
  it('records the opening once and shows the events in Romanian time', async () => {
    const auditList = vi.fn<(query: AuditQuery) => Promise<AuditPage>>(() => page([event()]));
    renderWithI18n(
      <AuditLog api={fakeApi({ auditList })} tenant="pilot" onSessionExpired={vi.fn()} />,
    );
    const table = await screen.findByRole('table');
    expect(auditList).toHaveBeenCalledTimes(1);
    expect(auditList.mock.calls[0]?.[0]).toMatchObject({ opened: '1', limit: '50' });
    // A widget-admin sees their own log: no chain chosen in the browser.
    expect(auditList.mock.calls[0]?.[0]).not.toHaveProperty('chain');
    const row = within(table).getAllByRole('row')[1];
    expect(row?.textContent).toContain('20.11.2026, 10:30:00');
    expect(row?.textContent).toContain('Ana Pop');
    expect(row?.textContent).toContain('Publicare');
    expect(row?.textContent).toContain('sensibil');
    expect(row?.textContent).toContain('Reușit');
    expect(screen.getByRole('status').textContent).toBe(
      '1 evenimente afișate, cele mai noi primele',
    );
  });

  it('applies the filters without recording another opening', async () => {
    const auditList = vi.fn<(query: AuditQuery) => Promise<AuditPage>>(() => page([]));
    renderWithI18n(
      <AuditLog api={fakeApi({ auditList })} tenant="pilot" onSessionExpired={vi.fn()} />,
    );
    await screen.findByText('Niciun eveniment pentru aceste filtre.', {
      selector: '.audit__empty',
    });
    fireEvent.input(screen.getByLabelText('De la data'), { target: { value: '2026-11-01' } });
    fireEvent.input(screen.getByLabelText('Până la data (inclusiv)'), {
      target: { value: '2026-11-20' },
    });
    fireEvent.input(screen.getByLabelText('Utilizator (nume, email sau ID)'), {
      target: { value: ' ana ' },
    });
    fireEvent.change(screen.getByLabelText('Acțiune'), { target: { value: 'auth.*' } });
    fireEvent.change(screen.getByLabelText('Rezultat'), { target: { value: 'denied' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplică filtrele' }));
    await waitFor(() => {
      expect(auditList).toHaveBeenCalledTimes(2);
    });
    const query = auditList.mock.calls[1]?.[0];
    expect(query).toEqual({
      from: '2026-10-31T22:00:00.000Z',
      to: '2026-11-20T22:00:00.000Z',
      user: 'ana',
      action: 'auth.*',
      result: 'denied',
      limit: '50',
    });
    // The export links carry the same filters.
    const csv = screen.getByRole('link', { name: 'Export CSV' }).getAttribute('href') ?? '';
    expect(csv).toContain('/admin/api/audit/export?');
    expect(new URLSearchParams(csv.split('?')[1]).get('action')).toBe('auth.*');
    expect(new URLSearchParams(csv.split('?')[1]).get('format')).toBe('csv');
  });

  it('opens the detail with who, from where and the old → new values', async () => {
    renderWithI18n(
      <AuditLog
        api={fakeApi({ auditList: () => page([event()]) })}
        tenant="pilot"
        onSessionExpired={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /^Detalii: Publicare/ }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('ana@pilot.ro');
    expect(dialog.textContent).toContain('10.0.0.7');
    expect(dialog.textContent).toContain('cont local');
    const diff = within(dialog).getByRole('row', { name: /theme\.accent/ });
    expect(diff.textContent).toContain('#111111');
    expect(diff.textContent).toContain('#222222');
    expect(dialog.textContent).toContain('domenii noi');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Închide' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('pages with the sequence number the gateway gave', async () => {
    const auditList = vi.fn((query: AuditQuery) =>
      query.before ? page([event({ id: 2, seq: 2, action: 'auth.login' })]) : page([event()], 9),
    );
    renderWithI18n(
      <AuditLog api={fakeApi({ auditList })} tenant="pilot" onSessionExpired={vi.fn()} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Încarcă mai multe' }));
    await waitFor(() => {
      expect(screen.getAllByRole('row')).toHaveLength(3);
    });
    expect(auditList.mock.calls[1]?.[0]).toMatchObject({ before: '9' });
    expect(auditList.mock.calls[1]?.[0]).not.toHaveProperty('opened');
  });

  it('lets the super-admin choose a client or the platform', async () => {
    const auditList = vi.fn<(query: AuditQuery) => Promise<AuditPage>>(() => page([]));
    renderWithI18n(
      <AuditLog
        api={fakeApi({ auditList })}
        tenant="pilot"
        chains={['pilot', 'demo-primarie', 'platform']}
        onSessionExpired={vi.fn()}
      />,
    );
    await screen.findByText('Niciun eveniment pentru aceste filtre.', {
      selector: '.audit__empty',
    });
    expect(auditList.mock.calls[0]?.[0]).toMatchObject({ chain: 'pilot', opened: '1' });
    fireEvent.change(screen.getByLabelText('Jurnalul'), { target: { value: 'platform' } });
    await waitFor(() => {
      expect(auditList).toHaveBeenCalledTimes(2);
    });
    expect(auditList.mock.calls[1]?.[0]).toMatchObject({ chain: 'platform', opened: '1' });
  });

  it('sends an expired session back to sign-in', async () => {
    const onSessionExpired = vi.fn();
    renderWithI18n(
      <AuditLog
        api={fakeApi({ auditList: () => Promise.reject(new ApiError(401, 'unauthorized')) })}
        tenant="pilot"
        onSessionExpired={onSessionExpired}
      />,
    );
    await waitFor(() => {
      expect(onSessionExpired).toHaveBeenCalled();
    });
  });
});

describe('the audit period', () => {
  it('uses Romanian days (summer and winter time)', () => {
    expect(romaniaMidnight('2026-11-20')).toBe('2026-11-19T22:00:00.000Z');
    expect(romaniaMidnight('2026-07-01')).toBe('2026-06-30T21:00:00.000Z');
    expect(romaniaMidnight('2026-12-31', 1)).toBe('2026-12-31T22:00:00.000Z');
  });

  it('leaves out empty filters', () => {
    expect(
      toQuery({ from: '', to: '', user: '  ', action: '', section: '', result: '', q: '' }),
    ).toEqual({});
  });

  it('shows times in Romania whatever the language', () => {
    expect(formatRomaniaTime('2026-07-01T09:00:00.000Z', 'en')).toBe('01/07/2026, 12:00:00');
  });
});
