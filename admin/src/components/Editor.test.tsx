import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api.js';
import { stash } from '../model.js';
import { configState, fakeApi, renderWithI18n } from '../test-utils.js';
import { Editor } from './Editor.js';

const rename = async (value: string) => {
  const input = await screen.findByLabelText('Numele clientului');
  fireEvent.input(input, { target: { value } });
};

describe('Editor', () => {
  beforeEach(() => {
    sessionStorage.clear();
    history.replaceState(null, '', '#');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('autosaves with the published version and draft revision it started from', async () => {
    const saveDraft = vi.fn(() =>
      Promise.resolve({ savedAt: '2026-11-18T10:00:00.000Z', revision: 1, errors: [] }),
    );
    renderWithI18n(
      <Editor api={fakeApi({ saveDraft })} tenant="pilot" onSessionExpired={vi.fn()} />,
    );
    await rename('Pilot nou');
    expect(screen.getByRole('status').textContent).toBe('Modificări nesalvate…');
    await waitFor(() => {
      expect(saveDraft).toHaveBeenCalledTimes(1);
    });
    expect(saveDraft).toHaveBeenCalledWith('pilot', {
      config: expect.objectContaining({ name: 'Pilot nou' }) as unknown,
      baseVersion: 3,
      draftRevision: null,
    });
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(/^Ciornă: salvată la/);
    });

    // The next save continues from the revision the server returned.
    await rename('Pilot nou 2');
    await waitFor(() => {
      expect(saveDraft).toHaveBeenCalledTimes(2);
    });
    expect(saveDraft).toHaveBeenLastCalledWith(
      'pilot',
      expect.objectContaining({ draftRevision: 1 }),
    );
  });

  it('on a conflict, explains who saved and stops instead of overwriting (request 1)', async () => {
    const saveDraft = vi.fn(() =>
      Promise.reject(
        new ApiError(409, 'draft_conflict', {
          publishedVersion: 3,
          draft: { revision: 2, updatedAt: '2026-11-18T10:00:00.000Z', updatedBy: 'Ion Editor' },
        }),
      ),
    );
    renderWithI18n(
      <Editor api={fakeApi({ saveDraft })} tenant="pilot" onSessionExpired={vi.fn()} />,
    );
    await rename('Al meu');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Ion Editor a salvat ciorna');
    expect(alert.textContent).toContain('nu au fost salvate');
    // Local edits stay on screen; no further save attempts.
    await rename('Al meu, din nou');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /^Publică/ }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });

  it('keeps the edits across a session expiry and restores them after login (request 3)', async () => {
    const onSessionExpired = vi.fn();
    const expiredApi = fakeApi({
      saveDraft: () => Promise.reject(new ApiError(401, 'unauthenticated')),
    });
    const first = renderWithI18n(
      <Editor api={expiredApi} tenant="pilot" onSessionExpired={onSessionExpired} />,
    );
    await rename('Nesalvat');
    await waitFor(() => {
      expect(onSessionExpired).toHaveBeenCalled();
    });
    expect(stash.load('pilot')).toEqual({
      config: expect.objectContaining({ name: 'Nesalvat' }) as unknown,
      baseVersion: 3,
      draftRevision: null,
    });
    first.unmount();

    // Back from the login: the stashed edits are shown and saved from their own base.
    const saveDraft = vi.fn(() =>
      Promise.resolve({ savedAt: '2026-11-18T10:00:00.000Z', revision: 1, errors: [] }),
    );
    renderWithI18n(
      <Editor api={fakeApi({ saveDraft })} tenant="pilot" onSessionExpired={vi.fn()} />,
    );
    expect(await screen.findByText(/au fost restaurate/)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Numele clientului').value).toBe('Nesalvat');
    await waitFor(() => {
      expect(saveDraft).toHaveBeenCalledWith(
        'pilot',
        expect.objectContaining({ baseVersion: 3, draftRevision: null }),
      );
    });
    await waitFor(() => {
      expect(stash.load('pilot')).toBeUndefined();
    });
  });

  it('blocks publishing on a contrast failure and names the colors', async () => {
    const api = fakeApi({
      config: () =>
        Promise.resolve(
          configState({
            draft: {
              revision: 1,
              baseVersion: 3,
              updatedAt: '2026-11-18T10:00:00.000Z',
              updatedBy: 'Ana',
              config: {
                name: 'Pilot',
                allowedOrigins: ['https://www.pilot.ro'],
                theme: { text: '#eeeeee' },
              },
            },
          }),
        ),
    });
    renderWithI18n(<Editor api={api} tenant="pilot" onSessionExpired={vi.fn()} />);
    const text = await screen.findByLabelText('Text');
    expect(text.getAttribute('aria-invalid')).toBe('true');
    expect(
      document.getElementById((text.getAttribute('aria-describedby') ?? '').split(' ')[0] ?? '')
        ?.textContent,
    ).toMatch(/Contrast 1\.\d+:1 față de „Fundal”; minimum 4\.5:1/);
    expect(screen.getByText(/^Corectați cele \d+ erori înainte de publicare\.$/)).toBeTruthy();
  });

  it('publishes after confirmation with the reviewed draft revision', async () => {
    const draftConfig = { name: 'Pilot 2', allowedOrigins: ['https://www.pilot.ro'] };
    const states = [
      configState({
        draft: {
          revision: 5,
          baseVersion: 3,
          updatedAt: '2026-11-18T10:00:00.000Z',
          updatedBy: 'Ana',
          config: draftConfig,
        },
      }),
      configState({ published: { ...configState().published, version: 4, config: draftConfig } }),
    ];
    const publish = vi.fn(() => Promise.resolve({ version: 4 }));
    const api = fakeApi({
      config: () => Promise.resolve(states.shift() ?? configState()),
      publish,
    });
    renderWithI18n(<Editor api={api} tenant="pilot" onSessionExpired={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Publică/ }));
    expect(screen.getByRole('dialog').textContent).toContain('Identitate');
    fireEvent.click(screen.getByRole('button', { name: 'Publică acum' }));
    await waitFor(() => {
      expect(publish).toHaveBeenCalledWith('pilot', { draftRevision: 5 });
    });
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Versiunea 4 a fost publicată.');
    });
  });

  it('shows when and by whom it was last published, and discards a draft after confirmation', async () => {
    const draft = {
      revision: 2,
      baseVersion: 3,
      updatedAt: '2026-11-18T10:00:00.000Z',
      updatedBy: 'Ana',
      config: { name: 'Pilot nou', allowedOrigins: ['https://www.pilot.ro'] },
    };
    const states = [configState({ draft }), configState()];
    const discardDraft = vi.fn(() => Promise.resolve());
    const api = fakeApi({
      config: () => Promise.resolve(states.shift() ?? configState()),
      discardDraft,
    });
    renderWithI18n(<Editor api={api} tenant="pilot" onSessionExpired={vi.fn()} />);
    expect(await screen.findByText(/^Publicat ultima dată: .+ de Ana$/)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/^Ciornă: salvată la \d{2}:\d{2}$/);

    fireEvent.click(screen.getByRole('button', { name: 'Renunță la modificări' }));
    const dialog = screen.getByRole('dialog', { name: 'Renunțați la modificări?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Renunță la modificări' }));
    await waitFor(() => {
      expect(discardDraft).toHaveBeenCalledWith('pilot');
    });
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>('Numele clientului').value).toBe('Pilot');
    });
    expect(screen.getByRole('status').textContent).toMatch(/au fost anulate/);
    expect(
      screen.getByRole('button', { name: 'Renunță la modificări' }).getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('texts: one language per tab, every field named by the text it replaces (no keys)', async () => {
    renderWithI18n(<Editor api={fakeApi()} tenant="pilot" onSessionExpired={vi.fn()} />);
    fireEvent.click(await screen.findByRole('link', { name: 'Texte și întrebări' }));
    const tabs = await screen.findByRole('tablist', { name: 'Limba textelor' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Română', 'Engleză']);
    expect(screen.getByText('Dacă lăsați gol, se folosește mesajul configurat în asistent.'));
    expect(screen.getByLabelText('„Deschide asistentul virtual”')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Mesaje de eroare' })).toBeTruthy();
    const labels = [...document.querySelectorAll('.workspace__form label, form label')].map(
      (label) => label.textContent,
    );
    expect(labels.filter((label) => /^[a-z]+\.[a-zA-Z_]+$/.test(label))).toEqual([]);
    expect(document.body.textContent).not.toMatch(/Dify|cookie/);

    fireEvent.click(within(tabs).getByRole('tab', { name: 'Engleză' }));
    expect(await screen.findByLabelText('„Open the virtual assistant”')).toBeTruthy();
  });

  it("shows the client's name read-only without the super-admin right", async () => {
    const api = fakeApi({
      config: () =>
        Promise.resolve({
          ...configState(),
          permissions: { publish: true, assets: true, origins: true, name: false },
        }),
    });
    renderWithI18n(<Editor api={api} tenant="pilot" onSessionExpired={vi.fn()} />);
    const name = await screen.findByLabelText<HTMLInputElement>('Numele clientului');
    expect(name.readOnly).toBe(true);
    expect(
      screen.getByText('Se modifică doar de echipa care administrează platforma.'),
    ).toBeTruthy();
  });

  it('colors: main color first, the rest folded and automatic, computed like the gateway', async () => {
    const api = fakeApi({
      config: () =>
        Promise.resolve(
          configState({
            draft: {
              revision: 1,
              baseVersion: 3,
              updatedAt: '2026-11-18T10:00:00.000Z',
              updatedBy: 'Ana',
              config: {
                name: 'Pilot',
                allowedOrigins: ['https://www.pilot.ro'],
                theme: { accent: '#2f9e44' },
              },
            },
          }),
        ),
    });
    renderWithI18n(<Editor api={api} tenant="pilot" onSessionExpired={vi.fn()} />);
    fireEvent.click(await screen.findByRole('link', { name: 'Culori' }));
    expect(screen.getByLabelText<HTMLInputElement>('Culoarea principală').value).toBe('#2f9e44');
    const advanced = screen.getByText('Culori avansate').closest('details');
    expect(advanced?.open).toBe(false);
    // A medium green: black text on it, links darkened to 4.5:1, a flat header.
    expect(screen.getAllByText('Automat: #000000').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Automat: #267e36')).toBeTruthy();
    expect(screen.getAllByText('Automat: #2f9e44').length).toBeGreaterThan(0);
    // The launcher: its own color, automatically the main one.
    expect(screen.getByLabelText<HTMLInputElement>('Culoarea butonului').placeholder).toBe(
      '#2f9e44',
    );
  });

  it('citations: suggests the documents the assistant cited recently (E4b.1 UX 13)', async () => {
    const api = fakeApi({
      citedDocuments: () =>
        Promise.resolve({
          documents: [
            { name: 'Regulament.pdf', lastSeen: '2026-11-19T10:00:00.000Z' },
            { name: 'Taxe 2026.xlsx', lastSeen: '2026-11-18T10:00:00.000Z' },
          ],
        }),
      config: () =>
        Promise.resolve(
          configState({
            draft: {
              revision: 1,
              baseVersion: 3,
              updatedAt: '2026-11-18T10:00:00.000Z',
              updatedBy: 'Ana',
              config: {
                name: 'Pilot',
                allowedOrigins: ['https://www.pilot.ro'],
                citations: { documentTitles: { 'Regulament.pdf': 'Regulamentul intern' } },
              },
            },
          }),
        ),
    });
    renderWithI18n(<Editor api={api} tenant="pilot" onSessionExpired={vi.fn()} />);
    fireEvent.click(await screen.findByRole('link', { name: /^Citări/ }));
    const file = await screen.findByLabelText<HTMLInputElement>('Nume fișier');
    await waitFor(() => {
      expect(file.getAttribute('list')).toBe('cited-documents');
    });
    // A document that already has a title is not suggested again.
    const options = [...document.querySelectorAll('#cited-documents option')].map(
      (option) => (option as HTMLOptionElement).value,
    );
    expect(options).toEqual(['Taxe 2026.xlsx']);
    expect(screen.getByText(/^Alegeți dintre documentele citate recent/)).toBeTruthy();
  });

  it('"Imagine" without an uploaded image shows only "Încarcă imagine" (no empty preview)', async () => {
    renderWithI18n(<Editor api={fakeApi()} tenant="pilot" onSessionExpired={vi.fn()} />);
    const avatars = await screen.findByRole('group', { name: /^Avatarul asistentului/ });
    fireEvent.click(within(avatars).getByRole('radio', { name: 'Imagine' }));
    const upload = await screen.findAllByRole('button', { name: 'Încarcă imagine' });
    // The logo keeps its preview square; the avatar row has only the button.
    const row = upload.at(-1)?.closest('.image-field');
    expect(row?.querySelector('.image-field__thumb')).toBeNull();
    expect(document.querySelectorAll('.image-field__thumb')).toHaveLength(1);
  });

  it('"same side as the launcher" is a switch in Fereastră; off, it shows the window position', async () => {
    renderWithI18n(<Editor api={fakeApi()} tenant="pilot" onSessionExpired={vi.fn()} />);
    const toggle = await screen.findByRole('switch', {
      name: 'Fereastra pe aceeași parte cu butonul',
    });
    expect(toggle.closest('section')?.getAttribute('aria-labelledby')).toBe('section-window');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    // Not in the colors section any more.
    expect(document.querySelector('[aria-labelledby="section-colors"] [role="switch"]')).toBeNull();
    expect(screen.queryByLabelText('Poziția ferestrei')).toBeNull();
    fireEvent.click(toggle);
    expect(await screen.findByLabelText('Poziția ferestrei')).toBeTruthy();
  });

  it('says under each image where it appears', async () => {
    renderWithI18n(<Editor api={fakeApi()} tenant="pilot" onSessionExpired={vi.fn()} />);
    expect(await screen.findByText('Apare în antetul ferestrei.')).toBeTruthy();
    expect(screen.getByText('Apare lângă răspunsurile asistentului.')).toBeTruthy();
    expect(screen.getByText('Apare lângă întrebările vizitatorului.')).toBeTruthy();
  });

  it('shows values (not grey placeholders) and only the fields that make sense', async () => {
    renderWithI18n(<Editor api={fakeApi()} tenant="pilot" onSessionExpired={vi.fn()} />);
    const offset = await screen.findByLabelText<HTMLInputElement>(
      'Distanța față de margine, orizontal (px)',
    );
    expect(offset.value).toBe('24');
    expect(offset.getAttribute('placeholder')).toBeNull();
    expect(screen.getAllByText('Implicit: 24').length).toBeGreaterThan(0);

    // Proactive message: its settings appear only once it is on.
    expect(screen.queryByLabelText('Textul mesajului (română)')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Mesaj proactiv' }));
    fireEvent.click(await screen.findByRole('switch', { name: 'Afișează mesajul proactiv' }));
    expect(await screen.findByLabelText('Textul mesajului (română)')).toBeTruthy();

    // Launcher icon (back in "Aspect"): the upload appears only for "Imagine încărcată".
    fireEvent.click(screen.getByRole('link', { name: 'Aspect' }));
    const launcherIcons = await screen.findByRole('group', { name: 'Iconul butonului' });
    expect(within(launcherIcons).getAllByRole('radio')).toHaveLength(8);
    expect(screen.queryByRole('group', { name: 'Imagine încărcată' })).toBeNull();
    fireEvent.click(within(launcherIcons).getByRole('radio', { name: 'Imagine' }));
    expect(await screen.findByRole('group', { name: 'Imagine încărcată' })).toBeTruthy();
    fireEvent.click(within(launcherIcons).getByRole('radio', { name: 'Căști' }));
    expect(screen.queryByRole('group', { name: 'Imagine încărcată' })).toBeNull();
  });
});
