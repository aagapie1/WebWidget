import { afterEach, describe, expect, it } from 'vitest';
import { delay, sse } from './fake-dify.js';
import { postJson, startHarness, type Harness } from './harness.js';

const TASK = '900bbd43-dc0b-4383-a372-aa6e6c414227';
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

describe('stop on browser disconnect', () => {
  it('asks Dify to stop the task when the browser leaves mid-answer', async () => {
    h = await startHarness();
    h.dify.handler = async (req, res) => {
      if (req.url.endsWith('/stop')) {
        res.writeHead(200).end('{"result":"success"}');
        return;
      }
      sse(res);
      for (let i = 0; i < 100 && !res.destroyed; i++) {
        res.write(
          `data: {"event":"message","task_id":"${TASK}","message_id":"m","conversation_id":"c","answer":"${i}"}\n\n`,
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

    await expect
      .poll(() => h.dify.requests.map((request) => request.url), { timeout: 2000 })
      .toContain(`/v1/chat-messages/${TASK}/stop`);
    const chatUser = (h.dify.requests[0]?.body as { user: string }).user;
    const stop = h.dify.requests.find((request) => request.url.endsWith('/stop'));
    expect(stop?.body).toEqual({ user: chatUser });
  });

  it('does not call stop when the answer completed normally', async () => {
    h = await startHarness();
    h.dify.handler = (_req, res) => {
      sse(res);
      res.end(
        `data: {"event":"message_end","task_id":"${TASK}","message_id":"m","conversation_id":"c"}\n\n`,
      );
    };
    await (await postJson(`${h.url}/api/chat`, { tenant: 'pilot', message: 'x' })).text();
    await delay(100);
    expect(h.dify.requests.map((request) => request.url)).toEqual(['/v1/chat-messages']);
  });
});

describe('GET /api/widget-config', () => {
  it('returns the assistant name and the Dify opening statement, cached', async () => {
    h = await startHarness({ tenant: { texts: {} } });
    h.dify.handler = (_req, res) =>
      res.writeHead(200).end('{"opening_statement":"  Bună ziua! Cu ce vă pot ajuta?  "}');

    const first = await fetch(`${h.url}/api/widget-config?tenant=pilot`);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      tenant: 'pilot',
      locale: 'ro',
      assistantName: 'Pilot',
      welcomeMessage: 'Bună ziua! Cu ce vă pot ajuta?',
    });
    await (await fetch(`${h.url}/api/widget-config?tenant=pilot`)).json();
    expect(h.dify.requests.map((request) => request.url)).toEqual(['/v1/parameters']);
    expect(h.dify.requests[0]?.headers.authorization).toMatch(/^Bearer /);
  });

  it('prefers tenant texts and does not call Dify', async () => {
    h = await startHarness({
      tenant: { texts: { en: { 'assistant.name': 'Ana', welcome: 'Hello!' } } },
    });
    const response = await fetch(`${h.url}/api/widget-config?tenant=pilot&locale=en`);
    expect(await response.json()).toEqual({
      tenant: 'pilot',
      locale: 'en',
      assistantName: 'Ana',
      welcomeMessage: 'Hello!',
    });
    expect(h.dify.requests).toHaveLength(0);
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
