import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { createRef } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ro } from '../i18n/ro.js';
import { Composer } from './Composer.js';

afterEach(cleanup);
describe('Composer', () => {
  function setup(busy = false) {
    const onSend = vi.fn();
    const onStop = vi.fn();
    render(
      <Composer texts={ro} busy={busy} onSend={onSend} onStop={onStop} inputRef={createRef()} />,
    );
    const input = screen.getByLabelText<HTMLTextAreaElement>('Mesajul dumneavoastră');
    return { onSend, onStop, input };
  }

  it('is labelled, described by the keyboard hint and limited in length', () => {
    const { input } = setup();
    expect(input.getAttribute('aria-describedby')).toBe('composer-hint');
    expect(document.getElementById('composer-hint')?.textContent).toBe(ro.composer.hint);
    expect(input.maxLength).toBe(4000);
  });

  it('sends with Enter, adds a line with Shift+Enter, then clears', () => {
    const { input, onSend } = setup();
    fireEvent.input(input, { target: { value: 'Bună ziua' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('Bună ziua');
    expect(input.value).toBe('');
  });

  it('disables sending an empty message', () => {
    const { input, onSend } = setup();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Trimite' }).disabled).toBe(true);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows a stop button while busy and does not send', () => {
    const { input, onSend, onStop } = setup(true);
    fireEvent.input(input, { target: { value: 'x' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Oprește răspunsul' }));
    expect(onStop).toHaveBeenCalledOnce();
  });
});
