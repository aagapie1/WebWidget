import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { useI18n } from '../i18n.js';

export const MAX_QUESTIONS = 5;

interface QuestionsEditorProps {
  /** The tenant's questions for one language; undefined: the assistant's own are used. */
  questions: readonly string[] | undefined;
  /** The assistant's questions (Dify), shown as a suggestion when the list is empty. */
  assistantQuestions: readonly string[];
  onChange: (questions: string[] | undefined) => void;
  errors?: Readonly<Record<string, readonly string[]>> | undefined;
  /** Error key prefix, e.g. `texts.ro.suggestedQuestions`. */
  errorPath: string;
}

/**
 * Starter questions (E4b.1 UX): an ordered list, at most 5. Reordering with the up/down buttons
 * (keyboard) or by dragging; the new position is announced. An empty list saves nothing, so the
 * assistant's questions are used.
 */
export function QuestionsEditor(props: QuestionsEditorProps) {
  const { t } = useI18n();
  const id = useId();
  const list = props.questions ?? [];
  const [announcement, setAnnouncement] = useState('');
  const [dragged, setDragged] = useState<number | undefined>();
  const focusAfter = useRef<{ index: number; control: string } | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);

  // After a move or an addition, keep the focus on the same control of the moved question.
  useEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    focusAfter.current = undefined;
    root.current
      ?.querySelector<HTMLElement>(
        `[data-question="${String(target.index)}"][data-control="${target.control}"]`,
      )
      ?.focus();
  });

  const commit = (next: string[]) => {
    props.onChange(next.length > 0 ? next : undefined);
  };
  const move = (from: number, to: number, control: string) => {
    if (to < 0 || to >= list.length || from === to) return;
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item ?? '');
    focusAfter.current = { index: to, control };
    setAnnouncement(t.ux.questions.moved(to + 1));
    commit(next);
  };

  if (list.length === 0) {
    return (
      <div class="field questions" ref={root}>
        <p class="field__label">{t.ux.questions.title}</p>
        {props.assistantQuestions.length > 0 ? (
          <div class="questions__suggested">
            <p class="field__hint">{t.ux.questions.fromAssistant}</p>
            <ol class="questions__assistant">
              {props.assistantQuestions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ol>
            <button
              type="button"
              class="button"
              onClick={() => {
                commit(props.assistantQuestions.slice(0, MAX_QUESTIONS));
              }}
            >
              {t.ux.questions.take}
            </button>
          </div>
        ) : (
          <p class="field__hint">{t.ux.questions.noneInAssistant}</p>
        )}
        <button
          type="button"
          class="button"
          onClick={() => {
            focusAfter.current = { index: 0, control: 'text' };
            commit(['']);
          }}
        >
          {t.ux.questions.add}
        </button>
      </div>
    );
  }

  return (
    <div class="field questions" ref={root}>
      <p class="field__label" id={`${id}-title`}>
        {t.ux.questions.title}
      </p>
      <p class="field__hint" id={`${id}-hint`}>
        {t.ux.questions.hint}
      </p>
      <ol class="questions__list" aria-labelledby={`${id}-title`}>
        {list.map((question, index) => {
          const n = index + 1;
          const errors = props.errors?.[`${props.errorPath}.${String(index)}`] ?? [];
          const errorId = `${id}-error-${String(index)}`;
          return (
            <li
              key={index}
              class={dragged === index ? 'question question--dragged' : 'question'}
              draggable
              onDragStart={(event) => {
                setDragged(index);
                event.dataTransfer?.setData('text/plain', String(index));
              }}
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragged !== undefined) move(dragged, index, 'text');
                setDragged(undefined);
              }}
              onDragEnd={() => {
                setDragged(undefined);
              }}
            >
              <span class="question__handle" aria-hidden="true">
                ⠿
              </span>
              <div class="question__body">
                <label class="visually-hidden" for={`${id}-q-${String(index)}`}>
                  {t.ux.questions.question(n)}
                </label>
                <input
                  id={`${id}-q-${String(index)}`}
                  type="text"
                  maxLength={200}
                  value={question}
                  data-question={index}
                  data-control="text"
                  aria-invalid={errors.length > 0}
                  aria-describedby={errors.length > 0 ? errorId : undefined}
                  onInput={(event) => {
                    const next = [...list];
                    next[index] = event.currentTarget.value;
                    commit(next);
                  }}
                />
                {errors.length > 0 && (
                  <ul id={errorId} class="field__errors">
                    {errors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div class="question__actions">
                <button
                  type="button"
                  class="icon-button"
                  aria-label={t.ux.questions.up(n)}
                  aria-disabled={index === 0 ? 'true' : undefined}
                  data-question={index}
                  data-control="up"
                  onClick={() => {
                    move(index, index - 1, 'up');
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="icon-button"
                  aria-label={t.ux.questions.down(n)}
                  aria-disabled={index === list.length - 1 ? 'true' : undefined}
                  data-question={index}
                  data-control="down"
                  onClick={() => {
                    move(index, index + 1, 'down');
                  }}
                >
                  ↓
                </button>
                <button
                  type="button"
                  class="icon-button"
                  aria-label={t.ux.questions.remove(n)}
                  onClick={() => {
                    focusAfter.current = { index: Math.max(0, index - 1), control: 'text' };
                    commit(list.filter((_, i) => i !== index));
                  }}
                >
                  ✕
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      {list.length < MAX_QUESTIONS ? (
        <button
          type="button"
          class="button"
          onClick={() => {
            focusAfter.current = { index: list.length, control: 'text' };
            commit([...list, '']);
          }}
        >
          {t.ux.questions.add}
        </button>
      ) : (
        <p class="field__hint">{t.ux.questions.max}</p>
      )}
      <p class="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
