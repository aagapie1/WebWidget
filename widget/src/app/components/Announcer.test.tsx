import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { Announcer } from './Announcer.js';

afterEach(cleanup);
describe('Announcer', () => {
  it('is a polite, atomic, visually hidden live region', () => {
    const { container } = render(<Announcer announcement={{ id: 1, text: 'Răspuns complet.' }} />);
    const region = container.firstElementChild;
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.getAttribute('aria-atomic')).toBe('true');
    expect(region?.className).toBe('visually-hidden');
    expect(region?.textContent).toBe('Răspuns complet.');
  });
});
