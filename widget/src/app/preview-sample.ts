import type { Locale } from 'gateway/protocol';
import type { ChatMessage } from './chat/controller.js';

/**
 * Sample conversation of the admin preview (ADR 008): a question and an answer with a link, a
 * citation and the rating buttons, so the draft's colors, avatars and texts are all visible.
 */
export function previewSample(locale: Locale): ChatMessage[] {
  const text =
    locale === 'en'
      ? {
          question: 'What are the opening hours?',
          answer:
            'We are open **Monday to Friday, 8:30–16:30**. You can also submit documents online, on the [services page](https://www.example.ro/servicii).',
          source: 'Rules of procedure',
        }
      : {
          question: 'Care este programul cu publicul?',
          answer:
            'Programul cu publicul este **luni–vineri, între 8:30 și 16:30**. Puteți depune actele și online, pe [pagina de servicii](https://www.example.ro/servicii).',
          source: 'Regulamentul de organizare',
        };
  return [
    { id: 'sample-question', author: 'user', text: text.question, status: 'complete' },
    {
      id: 'sample-answer',
      author: 'assistant',
      text: text.answer,
      status: 'complete',
      serverId: 'sample-answer',
      citations: [{ position: 1, title: text.source }],
      feedback: null,
    },
  ];
}
