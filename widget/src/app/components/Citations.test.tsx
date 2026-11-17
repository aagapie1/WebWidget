import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { ro } from '../i18n/ro.js';
import { Citations } from './Citations.js';

afterEach(cleanup);

describe('Citations', () => {
  it('lists source documents by title', () => {
    render(
      <Citations
        texts={ro}
        citations={[
          { position: 1, documentId: 'a', title: 'Regulamentul intern' },
          { position: 2, documentId: 'b', title: 'Tarife 2026' },
        ]}
      />,
    );
    expect(screen.getByText('Surse')).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Regulamentul intern',
      'Tarife 2026',
    ]);
  });

  it('shows a snippet behind a disclosure when the gateway sends one', () => {
    const { container } = render(
      <Citations texts={ro} citations={[{ position: 1, title: 'Ghid', snippet: 'Fragment.' }]} />,
    );
    expect(container.querySelector('details summary')?.textContent).toBe('Ghid');
    expect(container.querySelector('details p')?.textContent).toBe('Fragment.');
  });

  it('renders nothing without citations', () => {
    const { container } = render(<Citations texts={ro} citations={[]} />);
    expect(container.innerHTML).toBe('');
  });
});
