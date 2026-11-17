/** Romanian UI texts (default). English in en.ts (complete in E6). */
export const ro = {
  launcher: {
    open: 'Deschide asistentul virtual',
    close: 'Minimizează asistentul virtual',
  },
  frameTitle: 'Asistent virtual',
  header: {
    minimize: 'Minimizează',
    close: 'Închide fereastra',
    newConversation: 'Conversație nouă',
    subtitle: 'Răspunde imediat',
  },
  messages: {
    label: 'Mesaje',
    you: 'Dumneavoastră',
    typing: 'Asistentul scrie…',
    stopped: 'Răspuns oprit.',
    newConversationStarted: 'A început o conversație nouă.',
  },
  composer: {
    label: 'Mesajul dumneavoastră',
    placeholder: 'Scrieți întrebarea dumneavoastră…',
    hint: 'Enter trimite, Shift+Enter rând nou',
    send: 'Trimite',
    stop: 'Oprește răspunsul',
  },
  errors: {
    retry: 'Încearcă din nou',
    loadFailed: 'Asistentul nu a putut fi încărcat. Vă rugăm să reîncărcați pagina.',
    network: 'Conexiunea a fost întreruptă. Vă rugăm să încercați din nou.',
  },
  links: {
    newTab: '(se deschide într-o filă nouă)',
  },
};

export type Texts = typeof ro;
