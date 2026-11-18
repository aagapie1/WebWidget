import type { Texts } from './ro.js';

export const en: Texts = {
  launcher: {
    open: 'Open the virtual assistant',
    close: 'Minimize the virtual assistant',
  },
  frameTitle: 'Virtual assistant',
  proactive: {
    close: 'Dismiss message',
  },
  header: {
    minimize: 'Minimize window',
    newConversation: 'New conversation',
    closeConversation: 'Close conversation',
    conversations: 'My conversations',
    subtitle: 'Virtual assistant',
  },
  messages: {
    label: 'Messages',
    you: 'You',
    typing: 'The assistant is typing…',
    stopped: 'Answer stopped.',
    newConversationStarted: 'A new conversation has started.',
    loadOlder: 'Earlier messages',
  },
  composer: {
    label: 'Your message',
    placeholder: 'Type your question…',
    hint: 'Enter sends, Shift+Enter adds a new line',
    send: 'Send',
    stop: 'Stop the answer',
  },
  suggestions: {
    label: 'Suggested questions',
  },
  citations: {
    label: 'Sources',
  },
  feedback: {
    group: 'Rate this answer',
    like: 'Helpful answer',
    dislike: 'Unhelpful answer',
    thanks: 'Thank you for your rating.',
    removed: 'Your rating was removed.',
    closingTitle: 'How was the conversation?',
    closingIntro: 'Your opinion helps us improve the assistant.',
    closingLike: 'Helpful',
    closingDislike: 'Not helpful',
    commentLabel: 'Comment (optional)',
    commentHint: 'Please do not include personal data (ID number, phone, e-mail).',
    send: 'Send and close',
    skip: 'Close without rating',
    back: 'Back to the conversation',
    closingThanks: 'Thank you! The conversation was closed.',
    notSaved: 'Your rating could not be saved. The conversation was closed.',
  },
  conversations: {
    title: 'My conversations',
    back: 'Back to the conversation',
    empty: 'You have no earlier conversations.',
    untitled: 'Untitled conversation',
    current: 'current conversation',
    open: (title: string) => `Open the conversation “${title}”`,
    opened: (title: string) =>
      title ? `The conversation “${title}” is open.` : 'The conversation is open.',
    delete: (title: string) => `Delete the conversation “${title}”`,
    confirmDelete: 'Delete this conversation permanently?',
    confirm: 'Delete',
    cancel: 'Cancel',
    deleted: 'The conversation was deleted.',
    more: 'More conversations',
    updated: (date: string) => `updated ${date}`,
  },
  errors: {
    retry: 'Try again',
    loadFailed: 'The assistant could not be loaded. Please reload the page.',
    network: 'The connection was interrupted. Please try again.',
    answerFailed: 'The assistant could not answer this question.',
  },
  links: {
    newTab: '(opens in a new tab)',
  },
};
