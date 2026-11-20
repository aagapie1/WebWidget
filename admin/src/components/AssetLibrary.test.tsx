import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type StoredAsset } from '../api.js';
import { fakeApi, renderWithI18n } from '../test-utils.js';
import { AssetLibrary } from './AssetLibrary.js';

const asset = (overrides: Partial<StoredAsset>): StoredAsset => ({
  name: 'logo-0123456789ab.png',
  contentType: 'image/png',
  bytes: 4096,
  createdAt: '2026-11-20T08:00:00.000Z',
  createdBy: 'Ana Admin',
  versions: [],
  draft: false,
  ...overrides,
});

const LIST = [
  asset({ name: 'unused-000000000000.png' }),
  asset({ name: 'old-000000000000.png', versions: [3, 1] }),
  asset({ name: 'draft-000000000000.png', draft: true }),
];

describe('AssetLibrary', () => {
  it('shows where each image is used; only unused ones can be deleted', async () => {
    renderWithI18n(
      <AssetLibrary
        api={fakeApi({ listAssets: () => Promise.resolve({ assets: LIST }) })}
        tenant="pilot"
        canDelete
        refresh=""
        onSessionExpired={vi.fn()}
      />,
    );
    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain('Nefolosită');
    expect(items[1]?.textContent).toContain('Folosită în versiunile publicate: 3, 1');
    expect(items[2]?.textContent).toContain('Folosită în ciornă');
    expect(screen.getAllByRole('button', { name: /^Șterge imaginea/ })).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Șterge imaginea unused-000000000000.png' }),
    ).toBeTruthy();
  });

  it('asks before deleting, then reloads the list', async () => {
    const deleteAsset = vi.fn(() => Promise.resolve());
    const listAssets = vi
      .fn()
      .mockResolvedValueOnce({ assets: LIST })
      .mockResolvedValueOnce({ assets: LIST.slice(1) });
    renderWithI18n(
      <AssetLibrary
        api={fakeApi({ listAssets, deleteAsset })}
        tenant="pilot"
        canDelete
        refresh=""
        onSessionExpired={vi.fn()}
      />,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Șterge imaginea unused-000000000000.png' }),
    );
    const dialog = screen.getByRole('dialog');
    expect(deleteAsset).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Șterge imaginea' }));
    expect(deleteAsset).toHaveBeenCalledWith('pilot', 'unused-000000000000.png');
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });
    expect(screen.getByRole('status').textContent).toBe(
      'Imaginea unused-000000000000.png a fost ștearsă.',
    );
  });

  it('explains a refusal when the image started being used meanwhile', async () => {
    renderWithI18n(
      <AssetLibrary
        api={fakeApi({
          listAssets: () => Promise.resolve({ assets: LIST }),
          deleteAsset: () => Promise.reject(new ApiError(409, 'asset_in_use')),
        })}
        tenant="pilot"
        canDelete
        refresh=""
        onSessionExpired={vi.fn()}
      />,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Șterge imaginea unused-000000000000.png' }),
    );
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Șterge imaginea' }),
    );
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        'Imaginea a început între timp să fie folosită și nu a fost ștearsă.',
      );
    });
  });

  it('editors see the list without delete buttons', async () => {
    renderWithI18n(
      <AssetLibrary
        api={fakeApi({ listAssets: () => Promise.resolve({ assets: LIST }) })}
        tenant="pilot"
        canDelete={false}
        refresh=""
        onSessionExpired={vi.fn()}
      />,
    );
    expect(await screen.findAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
