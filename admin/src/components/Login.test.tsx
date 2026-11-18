import { fireEvent, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test-utils.js';
import { Login } from './Login.js';

describe('Login', () => {
  it('goes to the gateway login of the chosen organisation, returning to the same screen', () => {
    const navigate = vi.fn();
    renderWithI18n(
      <Login org="" error={undefined} returnTo="/admin/?tenant=pilot" navigate={navigate} />,
    );
    fireEvent.input(screen.getByLabelText('Codul organizației'), { target: { value: ' Pilot ' } });
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Continuă spre autentificare' })
        .closest('form') as HTMLFormElement,
    );
    expect(navigate).toHaveBeenCalledWith(
      '/admin/auth/login?org=pilot&returnTo=%2Fadmin%2F%3Ftenant%3Dpilot',
    );
  });

  it('explains login errors from the gateway', () => {
    renderWithI18n(
      <Login org="pilot" error="no_role" returnTo="/admin/" navigate={vi.fn()} />,
      'en',
    );
    expect(screen.getByRole('alert').textContent).toMatch(
      /not in the groups that manage the assistant/,
    );
    expect(screen.getByLabelText<HTMLInputElement>('Organisation code').value).toBe('pilot');
  });
});
