import { fireEvent, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test-utils.js';
import { QuestionsEditor } from './QuestionsEditor.js';

const props = { errorPath: 'texts.ro.suggestedQuestions', assistantQuestions: [] as string[] };

describe('QuestionsEditor', () => {
  it("offers the assistant's questions when the list is empty, to take and edit", () => {
    const onChange = vi.fn();
    renderWithI18n(
      <QuestionsEditor
        {...props}
        questions={undefined}
        assistantQuestions={['Care e programul?', 'Cum mă înscriu?']}
        onChange={onChange}
      />,
    );
    expect(screen.getByText('Care e programul?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Preia și editează' }));
    expect(onChange).toHaveBeenCalledWith(['Care e programul?', 'Cum mă înscriu?']);
  });

  it('reorders with the keyboard buttons and announces the new position', () => {
    const onChange = vi.fn();
    renderWithI18n(<QuestionsEditor {...props} questions={['A', 'B', 'C']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mută mai jos întrebarea 1' }));
    expect(onChange).toHaveBeenLastCalledWith(['B', 'A', 'C']);
    expect(screen.getByRole('status').textContent).toBe('Întrebarea a fost mutată pe poziția 2.');
    fireEvent.click(screen.getByRole('button', { name: 'Mută mai sus întrebarea 3' }));
    expect(onChange).toHaveBeenLastCalledWith(['A', 'C', 'B']);
    // Out of bounds: nothing happens.
    onChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Mută mai sus întrebarea 1' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reorders by dragging', () => {
    const onChange = vi.fn();
    renderWithI18n(<QuestionsEditor {...props} questions={['A', 'B', 'C']} onChange={onChange} />);
    const items = screen.getAllByRole('listitem');
    fireEvent.dragStart(items[2] as HTMLElement);
    fireEvent.dragOver(items[0] as HTMLElement);
    fireEvent.drop(items[0] as HTMLElement);
    expect(onChange).toHaveBeenLastCalledWith(['C', 'A', 'B']);
  });

  it('edits and deletes; an empty list saves nothing; at most 5', () => {
    const onChange = vi.fn();
    const { rerender } = renderWithI18n(
      <QuestionsEditor {...props} questions={['A']} onChange={onChange} />,
    );
    fireEvent.input(screen.getByLabelText('Întrebarea 1'), { target: { value: 'Alt text' } });
    expect(onChange).toHaveBeenLastCalledWith(['Alt text']);
    fireEvent.click(screen.getByRole('button', { name: 'Șterge întrebarea 1' }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);

    rerender(
      <QuestionsEditor {...props} questions={['1', '2', '3', '4', '5']} onChange={onChange} />,
    );
    expect(screen.queryByRole('button', { name: 'Adaugă întrebare' })).toBeNull();
    expect(screen.getByText('Ați ajuns la maximum 5 întrebări.')).toBeTruthy();
  });

  it('shows the errors of each question next to it', () => {
    renderWithI18n(
      <QuestionsEditor
        {...props}
        questions={['']}
        errors={{ 'texts.ro.suggestedQuestions.0': ['Câmp obligatoriu.'] }}
        onChange={vi.fn()}
      />,
    );
    const input = screen.getByLabelText('Întrebarea 1');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(input.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Câmp obligatoriu.',
    );
  });
});
