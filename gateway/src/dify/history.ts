import type { Tenant } from '../config/tenants.js';
import type { ConversationList, History, HistoryMessage } from '../protocol/index.js';
import { toCitations } from './citations.js';
import type { DifyConversationList, DifyMessageList } from './schemas.js';

/** Dify conversations → internal summaries (rule 10: the widget never sees Dify objects). */
export function toConversationList(list: DifyConversationList): ConversationList {
  return {
    conversations: list.data.map((conversation) => ({
      id: conversation.id,
      title: conversation.name?.trim() ?? '',
      updatedAt: conversation.updated_at ?? conversation.created_at,
    })),
    hasMore: list.has_more,
  };
}

/** Each Dify message (question + answer) becomes two internal messages, oldest first. */
export function toHistory(list: DifyMessageList, tenant: Pick<Tenant, 'citations'>): History {
  const messages: HistoryMessage[] = [];
  for (const item of [...list.data].sort((a, b) => a.created_at - b.created_at)) {
    messages.push({
      id: `${item.id}:q`,
      author: 'user',
      text: item.query,
      createdAt: item.created_at,
      citations: [],
      feedback: null,
      failed: false,
    });
    messages.push({
      id: item.id,
      author: 'assistant',
      text: item.answer,
      createdAt: item.created_at,
      citations: toCitations(item.retriever_resources ?? [], tenant),
      feedback: item.feedback?.rating ?? null,
      failed: item.status === 'error' && item.answer.trim() === '',
    });
  }
  return { messages, hasMore: list.has_more };
}
