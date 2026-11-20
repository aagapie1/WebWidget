import { render } from '@testing-library/preact';
import type { ComponentChildren } from 'preact';
import type { AdminApi, ConfigState } from './api.js';
import { dictionaries, I18n, type Locale } from './i18n.js';

/** Renders inside the I18n provider; `rerender` keeps the provider (no remount). */
export function renderWithI18n(ui: ComponentChildren, locale: Locale = 'ro') {
  const value = { locale, t: dictionaries[locale] };
  const wrap = (child: ComponentChildren) => <I18n.Provider value={value}>{child}</I18n.Provider>;
  const result = render(wrap(ui));
  return {
    ...result,
    rerender: (next: ComponentChildren) => {
      result.rerender(wrap(next));
    },
  };
}

export const ro = dictionaries.ro;

export function configState(overrides: Partial<ConfigState> = {}): ConfigState {
  return {
    tenant: 'pilot',
    published: {
      version: 3,
      createdAt: '2026-11-18T09:00:00.000Z',
      createdBy: 'Ana',
      config: {
        name: 'Pilot',
        allowedOrigins: ['https://www.pilot.ro'],
        theme: { accent: '#3a36d0' },
      },
    },
    draft: null,
    errors: [],
    permissions: { publish: true, assets: true, origins: true, name: true, retention: true },
    ...overrides,
  };
}

/** An API double whose methods tests can override. */
export function fakeApi(overrides: Partial<AdminApi> = {}): AdminApi {
  const never = () => new Promise<never>(() => undefined);
  return {
    session: never,
    config: () => Promise.resolve(configState()),
    saveDraft: never,
    publish: never,
    uploadAsset: never,
    previewToken: () =>
      Promise.resolve({ id: 'pilot--p-x', url: '/admin/preview?id=pilot--p-x', expiresAt: '' }),
    logout: never,
    discardDraft: () => Promise.resolve(),
    assistantDefaults: () =>
      Promise.resolve({ welcome: '', suggestedQuestions: [], available: false }),
    installations: () => Promise.resolve({ installations: [] }),
    citedDocuments: () => Promise.resolve({ documents: [] }),
    ...overrides,
  };
}
