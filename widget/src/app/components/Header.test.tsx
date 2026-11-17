import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ro } from '../i18n/ro.js';
import { Header } from './Header.js';

afterEach(cleanup);
describe('Header', () => {
  it('has a heading and labelled controls; minimize and X both hide', () => {
    const onHide = vi.fn();
    const onNew = vi.fn();
    render(<Header assistantName="Ana" texts={ro} onHide={onHide} onNewConversation={onNew} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Ana' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Minimizează' }));
    fireEvent.click(screen.getByRole('button', { name: 'Închide fereastra' }));
    expect(onHide).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Conversație nouă' }));
    expect(onNew).toHaveBeenCalledOnce();
  });
});
