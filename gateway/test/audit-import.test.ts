import { resolve } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminRealm } from '../src/admin/auth-config.js';
import { KeycloakEventImport } from '../src/audit/keycloak-import.js';
import { verifyChain } from '../src/audit/log.js';
import { migrate } from '../src/db/migrate.js';

const appUrl = process.env.TEST_DATABASE_URL;
const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
const KC = 'http://kc.test';
const realm: AdminRealm = {
  org: 'kc-import',
  kind: 'tenant',
  tenant: 'kc-import',
  issuer: `${KC}/realms/kc-import`,
  clientId: 'widget-admin-ui',
  clientSecret: 's',
  sessionSeconds: 3600,
  audit: { clientId: 'widget-audit-reader', clientSecret: 'reader-secret' },
};

/** A fake Keycloak: the token endpoint and the two event lists (newest first, like Keycloak). */
function fakeKeycloak() {
  const state = {
    down: false,
    events: [] as Record<string, unknown>[],
    adminEvents: [] as Record<string, unknown>[],
    tokenRequests: [] as URLSearchParams[],
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (state.down) return Promise.resolve(json({ error: 'down' }, 503));
    if (url.pathname.endsWith('/protocol/openid-connect/token')) {
      state.tokenRequests.push(new URLSearchParams(init?.body as URLSearchParams));
      return Promise.resolve(json({ access_token: 'token' }));
    }
    const list = url.pathname.endsWith('/admin-events') ? state.adminEvents : state.events;
    const first = Number(url.searchParams.get('first'));
    const max = Number(url.searchParams.get('max'));
    const sorted = [...list].sort((a, b) => Number(b.time) - Number(a.time));
    return Promise.resolve(json(sorted.slice(first, first + max)));
  });
  return { state, fetch: fetch as unknown as typeof globalThis.fetch };
}

const logger = () => {
  const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  return { log, as: log as unknown as FastifyBaseLogger };
};

describe.skipIf(!appUrl || !ownerUrl)('Keycloak events into the audit log (E5 B9, K1)', () => {
  let app: pg.Pool;
  let owner: pg.Pool;
  const T0 = Date.parse('2026-11-20T08:00:00.000Z');

  beforeAll(async () => {
    await migrate(ownerUrl ?? '', resolve('migrations'), () => undefined);
    app = new pg.Pool({ connectionString: appUrl });
    owner = new pg.Pool({ connectionString: ownerUrl });
  });
  afterAll(async () => {
    await app.end();
    await owner.end();
  });
  beforeEach(async () => {
    await owner.query("DELETE FROM audit_log WHERE chain = 'kc-import'");
    await owner.query("DELETE FROM audit_import_state WHERE realm = 'kc-import'");
  });

  const rows = async () =>
    (
      await app.query<Record<string, unknown>>(
        `SELECT action, result, reason, actor_subject, actor_name, actor_source, ip, sensitive,
                details, external_id, at FROM audit_log WHERE chain = 'kc-import' ORDER BY seq`,
      )
    ).rows;

  it('imports user and admin events once, mapped, without the import account itself', async () => {
    const keycloak = fakeKeycloak();
    keycloak.state.events.push(
      {
        id: 'e1',
        time: T0,
        type: 'LOGIN_ERROR',
        clientId: 'widget-admin-ui',
        userId: 'u-1',
        ipAddress: '203.0.113.5',
        error: 'invalid_user_credentials',
        details: { username: 'ana', auth_method: 'openid-connect' },
      },
      {
        id: 'e2',
        time: T0 + 1000,
        type: 'CLIENT_LOGIN',
        clientId: 'widget-audit-reader',
        details: { username: 'service-account-widget-audit-reader' },
      },
      {
        id: 'e3',
        time: T0 + 2000,
        type: 'LOGIN',
        clientId: 'widget-admin-ui',
        userId: 'u-2',
        sessionId: 's-1',
        details: { username: 'ion', identity_provider: 'idp-sim' },
      },
    );
    keycloak.state.adminEvents.push({
      id: 'a1',
      time: T0 + 3000,
      operationType: 'CREATE',
      resourceType: 'REALM_ROLE_MAPPING',
      resourcePath: 'users/u-2/role-mappings/realm',
      representation: '[{"name":"widget-editor"}]',
      authDetails: { userId: 'admin-1', ipAddress: '127.0.0.1' },
    });
    const { as } = logger();
    const importer = new KeycloakEventImport(app, [realm], as, {
      fetch: keycloak.fetch,
      now: () => T0 + 60_000,
      pageSize: 2,
    });
    await importer.runOnce();
    await importer.runOnce(); // the same events again: nothing new

    const events = await rows();
    expect(events.map((event) => [event.action, event.result, event.reason ?? null])).toEqual([
      ['keycloak.login_error', 'denied', 'invalid_user_credentials'],
      ['keycloak.login', 'success', null],
      ['keycloak.admin.realm_role_mapping.create', 'success', null],
    ]);
    expect(events[0]).toMatchObject({
      actor_subject: 'u-1',
      actor_name: 'ana',
      actor_source: 'local',
      ip: '203.0.113.5',
      external_id: 'user:e1',
    });
    expect((events[0]?.at as Date).toISOString()).toBe(new Date(T0).toISOString());
    expect(events[1]).toMatchObject({ actor_source: 'idp-sim' });
    expect(events[2]).toMatchObject({
      sensitive: true,
      details: {
        resourceType: 'REALM_ROLE_MAPPING',
        resourcePath: 'users/u-2/role-mappings/realm',
        representation: [{ name: 'widget-editor' }],
      },
    });
    // Read with the read-only client of this realm.
    expect(keycloak.state.tokenRequests[0]?.get('client_id')).toBe('widget-audit-reader');
    expect(keycloak.state.tokenRequests[0]?.get('grant_type')).toBe('client_credentials');
    expect((await verifyChain(app, 'kc-import')).problems).toEqual([]);
  });

  it('alerts once after 5 minutes of failure, and records the recovery with the interval', async () => {
    const keycloak = fakeKeycloak();
    let now = T0;
    const { log, as } = logger();
    const importer = new KeycloakEventImport(app, [realm], as, {
      fetch: keycloak.fetch,
      now: () => now,
    });
    keycloak.state.down = true;
    await importer.runOnce(); // T0: a warning
    now = T0 + 4 * 60_000;
    await importer.runOnce(); // 4 minutes: still a warning
    expect(log.error).not.toHaveBeenCalled();
    now = T0 + 6 * 60_000;
    await importer.runOnce(); // over 5 minutes: the alert
    now = T0 + 7 * 60_000;
    await importer.runOnce(); // once only
    const alerts = log.error.mock.calls.filter(
      ([fields]) => (fields as { alert?: string }).alert === 'audit_import_failing',
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.[0]).toMatchObject({
      realm: 'kc-import',
      failingSince: new Date(T0).toISOString(),
    });

    keycloak.state.down = false;
    keycloak.state.events.push({ id: 'e9', time: T0 + 5 * 60_000, type: 'LOGIN', userId: 'u-3' });
    now = T0 + 8 * 60_000;
    await importer.runOnce();
    // The missed event is imported, and the platform chain records the outage and what it covered.
    expect((await rows()).map((event) => event.external_id)).toEqual(['user:e9']);
    const recovered = (
      await app.query<{ details: Record<string, unknown> }>(
        `SELECT details FROM audit_log WHERE chain = 'platform' AND action = 'audit.import.recovered'
           AND details->>'realm' = 'kc-import' ORDER BY seq DESC LIMIT 1`,
      )
    ).rows[0];
    expect(recovered?.details).toMatchObject({
      realm: 'kc-import',
      failingSince: new Date(T0).toISOString(),
      recoveredAt: new Date(T0 + 8 * 60_000).toISOString(),
      coveredTo: new Date(T0 + 5 * 60_000).toISOString(),
      imported: 1,
    });
    const state = (
      await app.query<{ failing_since: Date | null; alerted: boolean }>(
        "SELECT failing_since, alerted FROM audit_import_state WHERE realm = 'kc-import'",
      )
    ).rows[0];
    expect(state).toEqual({ failing_since: null, alerted: false });
  });
});
