import { describe, expect, it } from 'vitest';
import { dictionaries } from './i18n.js';
import { changedSections, getIn, serverErrors, setIn, stash, validate } from './model.js';

const t = dictionaries.ro;
const valid = { name: 'Pilot', allowedOrigins: ['https://www.pilot.ro'] };

describe('admin model', () => {
  it('updates paths immutably and removes emptied values', () => {
    const config = { theme: { accent: '#000000' }, name: 'x' };
    const next = setIn(config, ['theme', 'link'], '#111111');
    expect(next).toEqual({ theme: { accent: '#000000', link: '#111111' }, name: 'x' });
    expect(config.theme).toEqual({ accent: '#000000' });
    expect(
      setIn(setIn(next, ['theme', 'link'], undefined), ['theme', 'accent'], undefined),
    ).toEqual({ name: 'x' });
    expect(getIn(next, ['theme', 'link'])).toBe('#111111');
  });

  it('lists the sections changed against the published version', () => {
    expect(
      changedSections(
        { ...valid, theme: { accent: '#000000' } },
        { ...valid, name: 'Nou', theme: { accent: '#111111' }, proactive: { enabled: true } },
      ),
    ).toEqual(['identity', 'window', 'proactive']);
    expect(changedSections(valid, valid)).toEqual([]);
  });

  it('validates with the gateway schema, in the interface language', () => {
    expect(validate('pilot', valid, t)).toEqual({});
    const errors = validate(
      'pilot',
      {
        ...valid,
        allowedOrigins: ['https://www.pilot.ro/pagina'],
        theme: { accent: 'blue' },
        window: { width: 100 },
      },
      t,
    );
    expect(errors['theme.accent']).toEqual([t.errors.color]);
    expect(errors['window.width']).toEqual([t.errors.tooSmall(320)]);
    expect(errors['allowedOrigins.0']).toEqual([t.errors.origin]);
    expect(
      validate('pilot', { ...valid, proactive: { enabled: true } }, t)['proactive.text'],
    ).toEqual([t.errors.proactiveText]);
  });

  it('marks both colors of a pair below the AA contrast', () => {
    const errors = validate('pilot', { ...valid, theme: { text: '#bbbbbb' } }, t);
    expect(errors['theme.text']?.[0]).toMatch(/^Contrast \d\.\d\d:1 față de „Fundal”/);
    expect(errors['theme.background']?.[0]).toMatch(/^Contrast \d\.\d\d:1 față de „Text”/);
  });

  it('keeps server messages that the client cannot check (images, Dify connection)', () => {
    expect(
      serverErrors([
        'identity.logo: logo.png not found in the images of tenant pilot',
        'theme.text: contrast 1.2:1 ...',
        'server: the Dify connection of this tenant is not configured',
      ]),
    ).toEqual({
      'identity.logo': ['logo.png not found in the images of tenant pilot'],
      server: ['the Dify connection of this tenant is not configured'],
    });
  });

  it('stashes pending edits per tenant in session storage', () => {
    stash.save('pilot', { config: { name: 'x' }, baseVersion: 2, draftRevision: 4 });
    expect(stash.load('pilot')).toEqual({
      config: { name: 'x' },
      baseVersion: 2,
      draftRevision: 4,
    });
    expect(stash.load('other')).toBeUndefined();
    stash.clear('pilot');
    expect(stash.load('pilot')).toBeUndefined();
    sessionStorage.setItem('admin:pending:pilot', 'not json');
    expect(stash.load('pilot')).toBeUndefined();
  });
});
