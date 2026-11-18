import { afterEach, describe, expect, it } from 'vitest';
import { toConversationList, toHistory } from '../src/dify/history.js';
import { difyConversationListSchema, difyMessageListSchema } from '../src/dify/schemas.js';
import { MemoryFeedbackStore } from '../src/feedback/store.js';
import { historySchema } from '../src/protocol/index.js';
import { sse } from './fake-dify.js';
import { fixture, testTenant } from './helpers.js';
import { ORIGIN, postJson, startHarness, type Harness } from './harness.js';

const CONVERSATION = '45701982-8118-4bc5-8e9b-64562b4555f2';
const MESSAGE = '663c5084-a254-4040-8ad3-51f2a3c1a77c';
let h: Harness;
let started = false;

afterEach(async () => {
  if (started) await h.close();
  started = false;
});

/** Sends one chat message so the gateway issues a visitor cookie; returns the cookie header. */
async function visitorCookie(): Promise<string> {
  const previous = h.dify.handler;
  h.dify.handler = (_req, res) => {
    sse(res);
    res.end(fixture('dify-chat.sse'));
  };
  const response = await postJson(`${h.url}/api/chat`, {
    tenant: 'pilot',
    message: 'x',
    conversationId: CONVERSATION,
  });
  await response.text();
  h.dify.handler = previous;
  h.dify.requests.length = 0;
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

describe('history normalization (pilot fixtures)', () => {
  it('splits each Dify message into question and answer, oldest first', () => {
    const list = difyMessageListSchema.parse(JSON.parse(fixture('dify-messages-pilot.json')));
    const history = toHistory(list, testTenant);
    expect(historySchema.parse(history)).toEqual(history);
    expect(history.messages).toHaveLength(list.data.length * 2);
    expect(history.messages.map((m) => m.author)).toEqual(
      list.data.flatMap(() => ['user', 'assistant']),
    );
    expect(history.messages[0]).toMatchObject({ text: 'query 1', citations: [], feedback: null });
    expect(history.messages[1]).toMatchObject({ text: 'answer 2', failed: false });
    expect(history.hasMore).toBe(false);
  });

  it('maps conversations to id, title and update time', () => {
    const list = difyConversationListSchema.parse(
      JSON.parse(fixture('dify-conversations-pilot.json')),
    );
    const result = toConversationList(list);
    expect(result.conversations[0]).toEqual({
      id: expect.any(String) as unknown,
      title: expect.stringMatching(/^name \d+$/) as unknown,
      updatedAt: expect.any(Number) as unknown,
    });
  });
});

describe('GET /api/conversations', () => {
  it('returns an empty list (and no cookie) for a visitor without a cookie', async () => {
    started = true;
    h = await startHarness();
    const response = await fetch(`${h.url}/api/conversations?tenant=pilot`);
    expect(await response.json()).toEqual({ conversations: [], hasMore: false });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(h.dify.requests).toHaveLength(0);
  });

  it('lists the visitor conversations from Dify', async () => {
    started = true;
    h = await startHarness();
    const cookie = await visitorCookie();
    h.dify.handler = (_req, res) =>
      res.writeHead(200).end(fixture('dify-conversations-pilot.json'));
    const response = await fetch(`${h.url}/api/conversations?tenant=pilot`, {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { conversations: unknown[] };
    expect(body.conversations.length).toBeGreaterThan(0);
    expect(h.dify.requests[0]?.url).toMatch(/^\/v1\/conversations\?user=[0-9a-f-]{36}&limit=20/);
  });
});

describe('GET /api/conversations/:id/messages', () => {
  it('returns normalized history for the visitor', async () => {
    started = true;
    h = await startHarness();
    const cookie = await visitorCookie();
    h.dify.handler = (_req, res) => res.writeHead(200).end(fixture('dify-messages-pilot.json'));
    const response = await fetch(
      `${h.url}/api/conversations/${CONVERSATION}/messages?tenant=pilot`,
      { headers: { cookie } },
    );
    expect(historySchema.parse(await response.json()).messages).toHaveLength(6);
    expect(h.dify.requests[0]?.url).toContain(`conversation_id=${CONVERSATION}`);
  });

  it('passes the pagination cursor and rejects invalid ids', async () => {
    started = true;
    h = await startHarness();
    const cookie = await visitorCookie();
    h.dify.handler = (_req, res) => res.writeHead(200).end('{"has_more":false,"data":[]}');
    await fetch(
      `${h.url}/api/conversations/${CONVERSATION}/messages?tenant=pilot&after=${MESSAGE}`,
      { headers: { cookie } },
    );
    expect(h.dify.requests[0]?.url).toContain(`first_id=${MESSAGE}`);
    const invalid = await fetch(`${h.url}/api/conversations/..%2Fx/messages?tenant=pilot`, {
      headers: { cookie },
    });
    expect(invalid.status).toBe(400);
  });

  it('maps Dify 404 (another visitor) to conversation_not_found', async () => {
    started = true;
    h = await startHarness();
    const cookie = await visitorCookie();
    h.dify.handler = (_req, res) => res.writeHead(404).end('{"code":"not_found"}');
    const response = await fetch(
      `${h.url}/api/conversations/${CONVERSATION}/messages?tenant=pilot`,
      { headers: { cookie } },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'conversation_not_found' } });
  });
});

describe('DELETE /api/conversations/:id', () => {
  it('deletes in Dify and removes the stored closing feedback', async () => {
    const feedbackStore = new MemoryFeedbackStore();
    started = true;
    h = await startHarness({ feedbackStore });
    const cookie = await visitorCookie();
    await feedbackStore.save('pilot', CONVERSATION, { rating: 'like', createdAt: 1 }, 60);
    h.dify.handler = (_req, res) => res.writeHead(204).end();

    const response = await fetch(`${h.url}/api/conversations/${CONVERSATION}?tenant=pilot`, {
      method: 'DELETE',
      headers: { cookie, origin: ORIGIN },
    });
    expect(response.status).toBe(204);
    expect(h.dify.requests[0]).toMatchObject({
      method: 'DELETE',
      url: `/v1/conversations/${CONVERSATION}`,
    });
    expect(await feedbackStore.get('pilot', CONVERSATION)).toBeUndefined();
  });

  it('requires our origin and a visitor cookie', async () => {
    started = true;
    h = await startHarness();
    const foreign = await fetch(`${h.url}/api/conversations/${CONVERSATION}?tenant=pilot`, {
      method: 'DELETE',
      headers: { origin: 'https://evil.example' },
    });
    expect(foreign.status).toBe(403);
    const anonymous = await fetch(`${h.url}/api/conversations/${CONVERSATION}?tenant=pilot`, {
      method: 'DELETE',
      headers: { origin: ORIGIN },
    });
    expect(anonymous.status).toBe(404);
    expect(h.dify.requests).toHaveLength(0);
  });
});

describe('feedback', () => {
  it('sends a message rating to Dify; null removes it', async () => {
    started = true;
    h = await startHarness();
    const cookie = await visitorCookie();
    h.dify.handler = (_req, res) => res.writeHead(200).end('{"result":"success"}');
    for (const rating of ['like', null] as const) {
      const response = await postJson(
        `${h.url}/api/messages/${MESSAGE}/feedback`,
        { tenant: 'pilot', rating },
        { cookie },
      );
      expect(response.status).toBe(204);
    }
    expect(h.dify.requests.map((r) => [r.url, r.body])).toEqual([
      [
        `/v1/messages/${MESSAGE}/feedbacks`,
        { rating: 'like', user: expect.any(String) as unknown },
      ],
      [`/v1/messages/${MESSAGE}/feedbacks`, { rating: null, user: expect.any(String) as unknown }],
    ]);
  });

  it('stores closing feedback with a masked comment and the tenant retention', async () => {
    const saved: unknown[] = [];
    const feedbackStore = new MemoryFeedbackStore();
    const original = feedbackStore.save.bind(feedbackStore);
    feedbackStore.save = async (...args) => {
      saved.push(args);
      await original(...args);
    };
    started = true;
    h = await startHarness({ feedbackStore, tenant: { feedback: { retentionDays: 30 } } });
    const cookie = await visitorCookie();
    h.dify.handler = (_req, res) => res.writeHead(200).end(fixture('dify-messages-pilot.json'));

    const response = await postJson(
      `${h.url}/api/conversations/${CONVERSATION}/feedback`,
      {
        tenant: 'pilot',
        rating: 'dislike',
        comment: '  Sunați-mă la 0722123456, CNP 1960523123456, ana@exemplu.ro  ',
      },
      { cookie },
    );
    expect(response.status).toBe(204);
    expect(saved).toEqual([
      [
        'pilot',
        CONVERSATION,
        {
          rating: 'dislike',
          comment: 'Sunați-mă la [telefon], CNP [CNP], [email]',
          createdAt: expect.any(Number) as unknown,
        },
        30 * 24 * 60 * 60,
      ],
    ]);
  });

  it('refuses closing feedback on a conversation the visitor does not own', async () => {
    started = true;
    h = await startHarness();
    const cookie = await visitorCookie();
    h.dify.handler = (_req, res) => res.writeHead(404).end('{"code":"not_found"}');
    const response = await postJson(
      `${h.url}/api/conversations/${CONVERSATION}/feedback`,
      { tenant: 'pilot', rating: 'like' },
      { cookie },
    );
    expect(response.status).toBe(404);
  });

  it('rejects a comment that is too long', async () => {
    started = true;
    h = await startHarness();
    const response = await postJson(`${h.url}/api/conversations/${CONVERSATION}/feedback`, {
      tenant: 'pilot',
      rating: 'like',
      comment: 'a'.repeat(1001),
    });
    expect(response.status).toBe(400);
  });
});

describe('Sec-Fetch-Site (ADR 005)', () => {
  it.each([
    ['cross-site', 403],
    ['same-site', 403],
    ['same-origin', 200],
  ])('%s → %i', async (site, status) => {
    started = true;
    h = await startHarness();
    const response = await fetch(`${h.url}/api/conversations?tenant=pilot`, {
      headers: { 'sec-fetch-site': site },
    });
    expect(response.status).toBe(status);
  });

  it('does not reject requests without the header', async () => {
    started = true;
    h = await startHarness();
    expect((await fetch(`${h.url}/api/conversations?tenant=pilot`)).status).toBe(200);
  });
});

describe('GET /api/messages/:id/suggested', () => {
  it('returns nothing and does not call Dify when the tenant has it off (default)', async () => {
    started = true;
    h = await startHarness();
    const cookie = await visitorCookie();
    const response = await fetch(`${h.url}/api/messages/${MESSAGE}/suggested?tenant=pilot`, {
      headers: { cookie },
    });
    expect(await response.json()).toEqual({ questions: [] });
    expect(h.dify.requests).toHaveLength(0);
  });

  it('asks Dify when the tenant enables it', async () => {
    started = true;
    h = await startHarness({
      tenant: { behavior: { suggestionsAfterAnswer: true, visitorCookieDays: 30 } },
    });
    const cookie = await visitorCookie();
    h.dify.handler = (_req, res) =>
      res.writeHead(200).end('{"result":"success","data":[" Și taxa? ","","Unde?","A","B"]}');
    const response = await fetch(`${h.url}/api/messages/${MESSAGE}/suggested?tenant=pilot`, {
      headers: { cookie },
    });
    expect(await response.json()).toEqual({ questions: ['Și taxa?', 'Unde?', 'A'] });
    expect(h.dify.requests[0]?.url).toContain(`/v1/messages/${MESSAGE}/suggested?user=`);
  });
});
