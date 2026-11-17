import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import type { Tenant } from '../src/config/tenants.js';
import type { FeedbackStore } from '../src/feedback/store.js';
import { FakeDify } from './fake-dify.js';
import { testTenant } from './helpers.js';

export const ORIGIN = 'http://gateway.test';

export interface Harness {
  app: FastifyInstance;
  dify: FakeDify;
  url: string;
  close(): Promise<void>;
}

/** Gateway listening on a random port, wired to a fresh fake Dify. */
export async function startHarness(
  options: {
    env?: Record<string, string>;
    tenant?: Partial<Tenant>;
    feedbackStore?: FeedbackStore;
  } = {},
): Promise<Harness> {
  const dify = new FakeDify();
  const difyBaseUrl = await dify.start();
  const tenant: Tenant = { ...testTenant, difyBaseUrl, ...options.tenant };
  const app = await buildApp({
    env: loadEnv({
      PUBLIC_ORIGIN: ORIGIN,
      VISITOR_COOKIE_SECRET: 's'.repeat(40),
      LOG_LEVEL: 'silent',
      ...options.env,
    }),
    tenants: new Map([[tenant.id, tenant]]),
    ...(options.feedbackStore ? { feedbackStore: options.feedbackStore } : {}),
  });
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  return {
    app,
    dify,
    url,
    async close() {
      await app.close();
      await dify.stop();
    },
  };
}

export function postJson(
  url: string,
  body: unknown,
  init: { origin?: string | null; cookie?: string; signal?: AbortSignal } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  if (init.cookie) headers.cookie = init.cookie;
  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    ...(init.signal ? { signal: init.signal } : {}),
  });
}
