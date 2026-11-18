import { afterEach, describe, expect, it } from 'vitest';
import { delay, sse } from './fake-dify.js';
import { postJson, startHarness, type Harness } from './harness.js';

const TASK = '900bbd43-dc0b-4383-a372-aa6e6c414227';
const CONVERSATION = '45701982-8118-4bc5-8e9b-64562b4555f2';
let h: Harness;

afterEach(async () => {
  await h.close();
});

describe('POST /api/chat/stop', () => {
  it('stops the Dify task for the same visitor', async () => {
    h = await startHarness();
    h.dify.handler = (_req, res) => res.writeHead(200).end('{"result":"success"}');

    const response = await postJson(`${h.url}/api/chat/stop`, { tenant: 'pilot', taskId: TASK });
    expect(response.status).toBe(204);
    const [request] = h.dify.requests;
    expect(request?.url).toBe(`/v1/chat-messages/${TASK}/stop`);
    expect(request?.body).toEqual({ user: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown });
  });

  it('rejects foreign origins and invalid task ids', async () => {
    h = await startHarness();
    const foreign = await postJson(
      `${h.url}/api/chat/stop`,
      { tenant: 'pilot', taskId: TASK },
      { origin: 'https://evil.example' },
    );
    expect(foreign.status).toBe(403);
    const invalid = await postJson(`${h.url}/api/chat/stop`, { tenant: 'pilot', taskId: '../x' });
    expect(invalid.status).toBe(400);
    expect(h.dify.requests).toHaveLength(0);
  });

  it('maps Dify errors', async () => {
    h = await startHarness();
    h.dify.handler = (_req, res) => res.writeHead(404).end('{"code":"not_found"}');
    const response = await postJson(`${h.url}/api/chat/stop`, { tenant: 'pilot', taskId: TASK });
    expect(response.status).toBe(404);
  });
});

describe('browser disconnect (ADR 005)', () => {
  it('does not stop the Dify task: the answer finishes and appears in the history', async () => {
    h = await startHarness();
    h.dify.handler = async (req, res) => {
      if (req.url.endsWith('/stop') || req.url.endsWith('/name')) {
        res.writeHead(200).end('{"result":"success"}');
        return;
      }
      sse(res);
      for (let i = 0; i < 20 && !res.destroyed; i++) {
        res.write(
          `data: {"event":"message","task_id":"${TASK}","message_id":"m","conversation_id":"c","answer":"${String(i)}"}\n\n`,
        );
        await delay(20);
      }
      res.end();
    };
    const controller = new AbortController();
    const response = await postJson(
      `${h.url}/api/chat`,
      { tenant: 'pilot', message: 'x' },
      { signal: controller.signal },
    );
    await response.body?.getReader().read();
    controller.abort();
    await delay(300);
    expect(h.dify.requests.some((request) => request.url.endsWith('/stop'))).toBe(false);
  });
});

const messageEnd = `data: {"event":"message_end","task_id":"${TASK}","message_id":"m","conversation_id":"${CONVERSATION}"}\n\n`;

describe('conversation title', () => {
  it('renames a new conversation from the question, without a model call', async () => {
    h = await startHarness();
    h.dify.handler = (req, res) => {
      if (req.url.endsWith('/name')) {
        res.writeHead(200).end('{}');
        return;
      }
      sse(res);
      res.end(messageEnd);
    };
    const question =
      'Care sunt condițiile de participare la cursul de prim ajutor pentru marinari?';
    await (await postJson(`${h.url}/api/chat`, { tenant: 'pilot', message: question })).text();
    await expect
      .poll(() => h.dify.requests.find((request) => request.url.endsWith('/name')))
      .toBeDefined();
    const rename = h.dify.requests.find((request) => request.url.endsWith('/name'));
    expect(rename?.url).toBe(`/v1/conversations/${CONVERSATION}/name`);
    expect(rename?.body).toEqual({
      name: 'Care sunt condițiile de participare la cursul de…',
      auto_generate: false,
      user: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
    });
  });

  it('does not rename an existing conversation', async () => {
    h = await startHarness();
    h.dify.handler = (_req, res) => {
      sse(res);
      res.end(messageEnd);
    };
    await (
      await postJson(`${h.url}/api/chat`, {
        tenant: 'pilot',
        message: 'x',
        conversationId: CONVERSATION,
      })
    ).text();
    await delay(100);
    expect(h.dify.requests.map((request) => request.url)).toEqual(['/v1/chat-messages']);
  });
});

describe('GET /api/widget-config', () => {
  const parameters = JSON.stringify({
    opening_statement: '  Bună ziua! Cu ce vă pot ajuta?  ',
    suggested_questions: [' Care e programul? ', '', 'Cum mă înscriu?'],
  });

  it('returns name, Dify opening statement and initial suggestions, cached', async () => {
    h = await startHarness({ tenant: { texts: {} } });
    h.dify.handler = (_req, res) => res.writeHead(200).end(parameters);

    const first = await fetch(`${h.url}/api/widget-config?tenant=pilot`);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      tenant: 'pilot',
      locale: 'ro',
      assistantName: 'Pilot',
      welcomeMessage: 'Bună ziua! Cu ce vă pot ajuta?',
      suggestedQuestions: ['Care e programul?', 'Cum mă înscriu?'],
    });
    await (await fetch(`${h.url}/api/widget-config?tenant=pilot`)).json();
    expect(h.dify.requests.map((request) => request.url)).toEqual(['/v1/parameters']);
    expect(h.dify.requests[0]?.headers.authorization).toMatch(/^Bearer /);
  });

  it('uses the identity name and the tenant welcome text', async () => {
    h = await startHarness({
      tenant: {
        identity: { assistantName: 'Ana', userAvatar: 'none' },
        texts: { en: { welcome: 'Hello!' } },
      },
    });
    h.dify.handler = (_req, res) => res.writeHead(200).end(parameters);
    const response = await fetch(`${h.url}/api/widget-config?tenant=pilot&locale=en`);
    expect(await response.json()).toMatchObject({
      tenant: 'pilot',
      locale: 'en',
      assistantName: 'Ana',
      welcomeMessage: 'Hello!',
      suggestedQuestions: ['Care e programul?', 'Cum mă înscriu?'],
    });
  });

  it('still answers with an empty welcome when Dify is down', async () => {
    h = await startHarness({ tenant: { texts: {} } });
    await h.dify.stop();
    const response = await fetch(`${h.url}/api/widget-config?tenant=pilot`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ welcomeMessage: '' });
  });

  it('rejects unknown tenants and invalid locales', async () => {
    h = await startHarness();
    expect((await fetch(`${h.url}/api/widget-config?tenant=nope`)).status).toBe(404);
    expect((await fetch(`${h.url}/api/widget-config?tenant=pilot&locale=fr`)).status).toBe(400);
  });

  it('never returns the Dify key', async () => {
    h = await startHarness();
    const text = await (await fetch(`${h.url}/api/widget-config?tenant=pilot`)).text();
    expect(text).not.toContain('app-');
  });
});
