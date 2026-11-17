import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import type { Tenant } from '../src/config/tenants.js';
import { chatStreamEventSchema, type ChatStreamEvent } from '../src/protocol/index.js';
import { VISITOR_COOKIE } from '../src/visitor/index.js';
import { delay, FakeDify, sse } from './fake-dify.js';
import { fixture, testTenant } from './helpers.js';

const ORIGIN = 'http://gateway.test';
const CONVERSATION = '45701982-8118-4bc5-8e9b-64562b4555f2';

let dify: FakeDify;
let app: FastifyInstance;
let gatewayUrl: string;

async function start(envOverrides: Record<string, string> = {}): Promise<void> {
  const difyBaseUrl = await dify.start();
  const tenant: Tenant = { ...testTenant, difyBaseUrl };
  app = await buildApp({
    env: loadEnv({
      PUBLIC_ORIGIN: ORIGIN,
      VISITOR_COOKIE_SECRET: 's'.repeat(40),
      LOG_LEVEL: 'silent',
      ...envOverrides,
    }),
    tenants: new Map([[tenant.id, tenant]]),
  });
  gatewayUrl = await app.listen({ host: '127.0.0.1', port: 0 });
}

beforeEach(() => {
  dify = new FakeDify();
});

afterEach(async () => {
  await app.close();
  await dify.stop();
});

function chat(
  body: object,
  init: { origin?: string | null; cookie?: string; signal?: AbortSignal } = {},
) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  if (init.cookie) headers.cookie = init.cookie;
  return fetch(`${gatewayUrl}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    ...(init.signal ? { signal: init.signal } : {}),
  });
}

function parseEvents(text: string): ChatStreamEvent[] {
  return text
    .split('\n\n')
    .filter((block) => block.startsWith('data: '))
    .map((block) => chatStreamEventSchema.parse(JSON.parse(block.slice('data: '.length))));
}

describe('POST /api/chat', () => {
  it('streams normalized events and sends auto_generate_name: false to Dify', async () => {
    await start();
    dify.handler = (_req, res) => {
      sse(res);
      res.end(fixture('dify-chat.sse'));
    };

    const response = await chat({ tenant: 'pilot', message: '  Care e programul?  ' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/event-stream/);
    expect(response.headers.get('x-request-id')).toBeTruthy();

    const text = await response.text();
    const events = parseEvents(text);
    expect(events.map((event) => event.type)).toEqual(['start', 'delta', 'delta', 'end']);
    expect(text).toContain(': ping\n\n');

    expect(dify.requests).toHaveLength(1);
    const [request] = dify.requests;
    expect(request?.url).toBe('/v1/chat-messages');
    expect(request?.headers.authorization).toBe(`Bearer ${testTenant.difyApiKey}`);
    expect(request?.body).toEqual({
      inputs: {},
      query: 'Care e programul?',
      response_mode: 'streaming',
      user: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      auto_generate_name: false,
    });
  });

  it('never exposes the Dify API key to the browser', async () => {
    await start();
    dify.handler = (_req, res) => {
      sse(res);
      res.end(fixture('dify-chat.sse'));
    };
    const ok = await chat({ tenant: 'pilot', message: 'Bună' });
    const okText = JSON.stringify([...ok.headers]) + (await ok.text());

    dify.handler = (_req, res) =>
      res.writeHead(401).end('{"code":"unauthorized","message":"bad key"}');
    const failed = await chat({ tenant: 'pilot', message: 'Bună' });
    const failedText = JSON.stringify([...failed.headers]) + (await failed.text());

    for (const text of [okText, failedText]) {
      expect(text).not.toContain(testTenant.difyApiKey);
      expect(text).not.toContain('app-');
      expect(text).not.toContain('bad key');
    }
  });

  it('continues a conversation and keeps auto_generate_name: false', async () => {
    await start();
    dify.handler = (_req, res) => {
      sse(res);
      res.end(fixture('dify-chat.sse'));
    };
    await (
      await chat({ tenant: 'pilot', message: 'A doua întrebare', conversationId: CONVERSATION })
    ).text();
    expect(dify.requests[0]?.body).toMatchObject({
      conversation_id: CONVERSATION,
      auto_generate_name: false,
    });
  });

  it('issues a signed visitor cookie and reuses it as the Dify user', async () => {
    await start();
    dify.handler = (_req, res) => {
      sse(res);
      res.end(fixture('dify-chat.sse'));
    };

    const first = await chat({ tenant: 'pilot', message: 'Bună' });
    await first.text();
    const setCookie = first.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${VISITOR_COOKIE}=`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=None/i);
    expect(setCookie).toMatch(/Partitioned/i);

    const cookie = setCookie.split(';')[0] ?? '';
    const second = await chat({ tenant: 'pilot', message: 'Din nou' }, { cookie });
    await second.text();
    expect(second.headers.get('set-cookie')).toBeNull();

    const users = dify.requests.map((request) => (request.body as { user: string }).user);
    expect(users[0]).toBe(users[1]);
  });

  it('ignores a tampered visitor cookie', async () => {
    await start();
    dify.handler = (_req, res) => {
      sse(res);
      res.end(fixture('dify-chat.sse'));
    };
    const forged = `${VISITOR_COOKIE}=00000000-0000-4000-8000-000000000000.forged-signature`;
    const response = await chat({ tenant: 'pilot', message: 'Bună' }, { cookie: forged });
    await response.text();
    expect((dify.requests[0]?.body as { user: string }).user).not.toBe(
      '00000000-0000-4000-8000-000000000000',
    );
    expect(response.headers.get('set-cookie')).toContain(`${VISITOR_COOKIE}=`);
  });

  describe('request validation', () => {
    it.each([
      ['a foreign origin', { origin: 'https://evil.example' }],
      ['no origin', { origin: null }],
    ] as const)('rejects %s with 403', async (_label, init) => {
      await start();
      const response = await chat({ tenant: 'pilot', message: 'Bună' }, init);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: 'forbidden_origin' } });
      expect(dify.requests).toHaveLength(0);
    });

    it.each([
      ['an empty message', { tenant: 'pilot', message: '   ' }],
      ['a too long message', { tenant: 'pilot', message: 'a'.repeat(4001) }],
      ['an invalid conversation id', { tenant: 'pilot', message: 'x', conversationId: '../x' }],
      ['an unknown field', { tenant: 'pilot', message: 'x', auto_generate_name: true }],
      ['an invalid locale', { tenant: 'pilot', message: 'x', locale: 'fr' }],
    ])('rejects %s with 400', async (_label, body) => {
      await start();
      const response = await chat(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: 'invalid_request', retryable: false },
      });
      expect(dify.requests).toHaveLength(0);
    });

    it('rejects an unknown tenant with 404', async () => {
      await start();
      const response = await chat({ tenant: 'missing', message: 'Bună', locale: 'en' });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: {
          code: 'tenant_not_found',
          message: 'The assistant is not available on this site.',
          retryable: false,
        },
      });
    });

    it('rejects malformed JSON with 400', async () => {
      await start();
      const response = await fetch(`${gatewayUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: '{not json',
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
    });
  });

  describe('errors and timeouts', () => {
    it('maps a Dify HTTP error to JSON with the matching status', async () => {
      await start();
      dify.handler = (_req, res) =>
        res
          .writeHead(404, { 'content-type': 'application/json' })
          .end('{"code":"not_found","message":"Conversation Not Exists.","status":404}');
      const response = await chat({ tenant: 'pilot', message: 'x', conversationId: CONVERSATION });
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        error: { code: 'conversation_not_found', retryable: false },
      });
    });

    it('reports Dify unreachable as upstream_unavailable (503)', async () => {
      await start();
      await dify.stop();
      const response = await chat({ tenant: 'pilot', message: 'x' });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: {
          code: 'upstream_unavailable',
          message:
            'Asistentul nu este disponibil momentan. Vă rugăm să încercați din nou peste câteva minute.',
          retryable: true,
        },
      });
    });

    it('times out when Dify does not answer (504, tenant text)', async () => {
      await start({ DIFY_CONNECT_TIMEOUT_MS: '100' });
      dify.handler = async (_req, res) => {
        await delay(1000);
        res.end();
      };
      const response = await chat({ tenant: 'pilot', message: 'x' });
      expect(response.status).toBe(504);
      expect(await response.json()).toMatchObject({
        error: { code: 'upstream_timeout', message: 'Text personalizat pentru timeout.' },
      });
    });

    it('sends an error event when the stream goes silent', async () => {
      await start({ DIFY_IDLE_TIMEOUT_MS: '150' });
      dify.handler = async (_req, res) => {
        sse(res);
        res.write(
          'data: {"event":"message","task_id":"t","message_id":"m","conversation_id":"c","answer":"Încep"}\n\n',
        );
        await delay(1000);
        res.end();
      };
      const events = parseEvents(await (await chat({ tenant: 'pilot', message: 'x' })).text());
      expect(events.map((event) => event.type)).toEqual(['start', 'delta', 'error']);
      expect(events.at(-1)).toMatchObject({ error: { code: 'upstream_timeout', retryable: true } });
    });

    it('sends an error event when the whole answer exceeds the total timeout', async () => {
      await start({ DIFY_TOTAL_TIMEOUT_MS: '300' });
      dify.handler = async (_req, res) => {
        sse(res);
        for (let i = 0; i < 20; i++) {
          if (res.destroyed) return;
          res.write(
            `data: {"event":"message","task_id":"t","message_id":"m","conversation_id":"c","answer":"${i}"}\n\n`,
          );
          await delay(50);
        }
        res.end();
      };
      const events = parseEvents(await (await chat({ tenant: 'pilot', message: 'x' })).text());
      expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'upstream_timeout' } });
    });

    it('sends an error event when the stream breaks before message_end', async () => {
      await start();
      dify.handler = (_req, res) => {
        sse(res);
        res.end(
          'data: {"event":"message","task_id":"t","message_id":"m","conversation_id":"c","answer":"a"}\n\n',
        );
      };
      const events = parseEvents(await (await chat({ tenant: 'pilot', message: 'x' })).text());
      expect(events.at(-1)).toMatchObject({
        type: 'error',
        error: { code: 'upstream_unavailable' },
      });
    });

    it('closes the Dify connection when the browser disconnects', async () => {
      await start();
      dify.handler = async (_req, res) => {
        sse(res);
        for (let i = 0; i < 100 && !res.destroyed; i++) {
          res.write(
            `data: {"event":"message","task_id":"t","message_id":"m","conversation_id":"c","answer":"${i}"}\n\n`,
          );
          await delay(20);
        }
        res.end();
      };
      const controller = new AbortController();
      const response = await chat({ tenant: 'pilot', message: 'x' }, { signal: controller.signal });
      const reader = response.body?.getReader();
      await reader?.read();
      controller.abort();
      await expect
        .poll(() => dify.closedConnections, { timeout: 2000 })
        .toEqual(['/v1/chat-messages']);
    });
  });

  it('answers GET /healthz', async () => {
    await start();
    const response = await fetch(`${gatewayUrl}/healthz`);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});
