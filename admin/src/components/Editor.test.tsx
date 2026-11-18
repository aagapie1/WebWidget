import { fireEvent, screen, waitFor } from '@testing-library/preact';
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
      expect(screen.getByRole('status').textContent).toMatch(/^Ciornă salvată la/);
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
    expect(screen.getByRole('button', { name: 'Publică' }).getAttribute('aria-disabled')).toBe(
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
    fireEvent.click(await screen.findByRole('button', { name: 'Publică' }));
    expect(screen.getByRole('dialog').textContent).toContain('Identitate');
    fireEvent.click(screen.getByRole('button', { name: 'Publică acum' }));
    await waitFor(() => {
      expect(publish).toHaveBeenCalledWith('pilot', { draftRevision: 5 });
    });
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Versiunea 4 a fost publicată.');
    });
  });
});
