import { fireEvent, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test-utils.js';
import { ColorField } from './ColorField.js';
import { CheckboxField, NumberField, TextField } from './Field.js';

describe('form fields (spec §7)', () => {
  it('links errors and hints to the control and marks it invalid', () => {
    renderWithI18n(
      <TextField
        label="Nume"
        hint="Ajutor"
        value="x"
        errors={['Câmp obligatoriu.']}
        onChange={() => undefined}
      />,
    );
    const input = screen.getByLabelText('Nume');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ');
    const texts = described.map((id) => document.getElementById(id)?.textContent);
    expect(texts).toEqual(['Câmp obligatoriu.', 'Ajutor']);
  });

  it('removes the value when a text or number field is emptied (the default applies)', () => {
    const onText = vi.fn();
    const onNumber = vi.fn();
    renderWithI18n(
      <>
        <TextField label="Text" value="a" onChange={onText} />
        <NumberField
          label="Număr"
          value={3}
          defaultValue={24}
          min={0}
          max={10}
          onChange={onNumber}
        />
      </>,
    );
    fireEvent.input(screen.getByLabelText('Text'), { target: { value: '' } });
    fireEvent.input(screen.getByLabelText('Număr'), { target: { value: '' } });
    expect(onText).toHaveBeenCalledWith(undefined);
    expect(onNumber).toHaveBeenCalledWith(undefined);
    fireEvent.input(screen.getByLabelText('Număr'), { target: { value: '7' } });
    expect(onNumber).toHaveBeenLastCalledWith(7);
  });

  it('labels checkboxes', () => {
    const onChange = vi.fn();
    renderWithI18n(<CheckboxField label="Activ" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Activ'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('edits colors as text, shows the default and offers a reset', () => {
    const onChange = vi.fn();
    const { rerender } = renderWithI18n(
      <ColorField label="Fundal" value={undefined} fallback="#ffffff" onChange={onChange} />,
    );
    const input = screen.getByLabelText('Fundal');
    expect(input.getAttribute('placeholder')).toBe('#ffffff');
    expect(screen.getByText('Implicit: #ffffff')).toBeTruthy();
    fireEvent.input(input, { target: { value: ' #112233 ' } });
    expect(onChange).toHaveBeenCalledWith('#112233');

    rerender(
      <ColorField
        label="Fundal"
        value="#112233"
        fallback="#ffffff"
        onChange={onChange}
        errors={['Contrast prea mic']}
      />,
    );
    expect(screen.getByLabelText('Fundal').getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /^Revino la implicit/ }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});
