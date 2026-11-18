/** Romanian UI texts (default). English in en.ts (complete in E6). */
export const ro = {
  launcher: {
    open: 'Deschide asistentul virtual',
    close: 'Minimizează asistentul virtual',
  },
  frameTitle: 'Asistent virtual',
  proactive: {
    close: 'Închide mesajul',
  },
  header: {
    minimize: 'Minimizează fereastra',
    newConversation: 'Conversație nouă',
    closeConversation: 'Închide conversația',
    conversations: 'Conversațiile mele',
    subtitle: 'Asistent virtual',
  },
  messages: {
    label: 'Mesaje',
    you: 'Dumneavoastră',
    typing: 'Asistentul scrie…',
    stopped: 'Răspuns oprit.',
    newConversationStarted: 'A început o conversație nouă.',
    loadOlder: 'Mesaje anterioare',
  },
  composer: {
    label: 'Mesajul dumneavoastră',
    placeholder: 'Scrieți întrebarea dumneavoastră…',
    hint: 'Enter trimite, Shift+Enter rând nou',
    send: 'Trimite',
    stop: 'Oprește răspunsul',
  },
  suggestions: {
    label: 'Întrebări sugerate',
  },
  citations: {
    label: 'Surse',
  },
  feedback: {
    group: 'Evaluați răspunsul',
    like: 'Răspuns util',
    dislike: 'Răspuns neutil',
    thanks: 'Mulțumim pentru evaluare.',
    removed: 'Evaluarea a fost retrasă.',
    closingTitle: 'Cum a fost conversația?',
    closingIntro: 'Părerea dumneavoastră ne ajută să îmbunătățim asistentul.',
    closingLike: 'Utilă',
    closingDislike: 'Neutilă',
    commentLabel: 'Comentariu (opțional)',
    commentHint: 'Vă rugăm să nu includeți date personale (CNP, telefon, e-mail).',
    send: 'Trimite și închide',
    skip: 'Închide fără evaluare',
    back: 'Înapoi la conversație',
    closingThanks: 'Mulțumim! Conversația a fost închisă.',
    notSaved: 'Evaluarea nu a putut fi salvată. Conversația a fost închisă.',
  },
  conversations: {
    title: 'Conversațiile mele',
    back: 'Înapoi la conversație',
    empty: 'Nu aveți conversații anterioare.',
    untitled: 'Conversație fără titlu',
    current: 'conversația curentă',
    open: (title: string) => `Deschide conversația „${title}”`,
    opened: (title: string) =>
      title ? `Conversația „${title}” a fost deschisă.` : 'Conversația a fost deschisă.',
    delete: (title: string) => `Șterge conversația „${title}”`,
    confirmDelete: 'Ștergeți definitiv această conversație?',
    confirm: 'Șterge',
    cancel: 'Anulează',
    deleted: 'Conversația a fost ștearsă.',
    more: 'Mai multe conversații',
    updated: (date: string) => `actualizată ${date}`,
  },
  errors: {
    retry: 'Încearcă din nou',
    loadFailed: 'Asistentul nu a putut fi încărcat. Vă rugăm să reîncărcați pagina.',
    network: 'Conexiunea a fost întreruptă. Vă rugăm să încercați din nou.',
    answerFailed: 'Asistentul nu a putut răspunde la această întrebare.',
  },
  links: {
    newTab: '(se deschide într-o filă nouă)',
  },
};

export type Texts = typeof ro;
