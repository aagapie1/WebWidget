import { createHash } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import type { AdminRealm } from '../admin/auth-config.js';
import { PLATFORM_CHAIN, recordAudit, type AuditEvent } from './log.js';

/**
 * Imports each realm's Keycloak events into the audit log (E5 B9, K1): failed passwords, lockouts,
 * IdP sign-ins, password changes (user events), and role, group and user changes (admin events,
 * with their representation). Read with a client whose service account has only
 * realm-management/view-events. Every minute; Keycloak keeps 7 days as a buffer; each event is
 * imported once (its Keycloak id).
 */

const userEventSchema = z.object({
  id: z.string(),
  time: z.number(),
  type: z.string(),
  clientId: z.string().optional(),
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  ipAddress: z.string().optional(),
  error: z.string().optional(),
  details: z.record(z.string(), z.string()).optional(),
});
type UserEvent = z.infer<typeof userEventSchema>;

const adminEventSchema = z.object({
  id: z.string(),
  time: z.number(),
  operationType: z.string(),
  resourceType: z.string().optional(),
  resourcePath: z.string().optional(),
  representation: z.string().optional(),
  error: z.string().optional(),
  authDetails: z
    .object({
      userId: z.string().optional(),
      ipAddress: z.string().optional(),
      clientId: z.string().optional(),
    })
    .optional(),
});
type AdminEvent = z.infer<typeof adminEventSchema>;

/** User events that are failures (the user was refused). */
const REPRESENTATION_LIMIT = 10_000;
/** Admin changes to who can do what: always sensitive. */
const SENSITIVE_RESOURCES = new Set([
  'USER',
  'GROUP',
  'GROUP_MEMBERSHIP',
  'REALM_ROLE',
  'REALM_ROLE_MAPPING',
  'CLIENT_ROLE',
  'CLIENT_ROLE_MAPPING',
  'IDENTITY_PROVIDER',
  'IDENTITY_PROVIDER_MAPPER',
  'REALM',
  'CLIENT',
]);

const chainOfRealm = (realm: AdminRealm): string => realm.tenant ?? PLATFORM_CHAIN;
const sessionHash = (id: string | undefined): string | undefined =>
  id ? createHash('sha256').update(id).digest('base64url').slice(0, 22) : undefined;

export function userEventToAudit(realm: AdminRealm, event: UserEvent): AuditEvent {
  const details = event.details ?? {};
  return {
    chain: chainOfRealm(realm),
    tenant: realm.tenant ?? '*',
    actor: {
      kind: 'user',
      issuer: realm.issuer,
      subject: event.userId ?? 'unknown',
      ...(details.username ? { name: details.username } : {}),
      org: realm.org,
      source: details.identity_provider ?? 'local',
    },
    context: {
      ...(event.ipAddress ? { ip: event.ipAddress } : {}),
      ...(sessionHash(event.sessionId) ? { sessionHash: sessionHash(event.sessionId) } : {}),
    },
    action: `keycloak.${event.type.toLowerCase()}`,
    // LOGIN_ERROR and the other *_ERROR events: the user was refused.
    result: event.error ? 'denied' : 'success',
    ...(event.error ? { reason: event.error } : {}),
    sensitive: event.type.startsWith('UPDATE_PASSWORD') || event.type.startsWith('RESET_PASSWORD'),
    details: { ...details, ...(event.clientId ? { clientId: event.clientId } : {}) },
    source: 'keycloak',
    externalId: `user:${event.id}`,
    at: new Date(event.time),
  };
}

export function adminEventToAudit(realm: AdminRealm, event: AdminEvent): AuditEvent {
  // The changed object as Keycloak sent it (a JSON string), parsed; very large ones only sized.
  let representation: unknown = undefined;
  const raw = event.representation;
  if (raw !== undefined) {
    try {
      representation = JSON.parse(raw) as unknown;
    } catch {
      representation = raw.slice(0, REPRESENTATION_LIMIT);
    }
    if (raw.length > REPRESENTATION_LIMIT) {
      representation = { truncated: true, size: raw.length };
    }
  }
  const resource = event.resourceType ?? 'UNKNOWN';
  return {
    chain: chainOfRealm(realm),
    tenant: realm.tenant ?? '*',
    actor: {
      kind: 'user',
      issuer: realm.issuer,
      subject: event.authDetails?.userId ?? 'unknown',
      org: realm.org,
      source: 'keycloak-admin',
    },
    context: event.authDetails?.ipAddress ? { ip: event.authDetails.ipAddress } : {},
    action: `keycloak.admin.${resource.toLowerCase()}.${event.operationType.toLowerCase()}`,
    section: 'keycloak',
    result: event.error ? 'failed' : 'success',
    ...(event.error ? { reason: event.error } : {}),
    sensitive: SENSITIVE_RESOURCES.has(resource),
    details: {
      resourceType: resource,
      ...(event.resourcePath ? { resourcePath: event.resourcePath } : {}),
      ...(representation !== undefined ? { representation } : {}),
    },
    source: 'keycloak',
    externalId: `admin:${event.id}`,
    at: new Date(event.time),
  };
}

interface ImportState {
  events_after: string;
  admin_events_after: string;
  failing_since: Date | null;
  alerted: boolean;
}

export interface KeycloakImportOptions {
  fetch?: typeof fetch;
  now?: () => number;
  /** The structured alert after this long without a successful import (K1: 5 minutes). */
  alertAfterMs?: number;
  pageSize?: number;
}

const LEADER_LOCK = "hashtextextended('audit-import', 0)";

export class KeycloakEventImport {
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #alertAfterMs: number;
  readonly #pageSize: number;
  #timer: NodeJS.Timeout | undefined;
  #running: Promise<void> | undefined;

  constructor(
    private readonly pool: pg.Pool,
    private readonly realms: readonly AdminRealm[],
    private readonly log: FastifyBaseLogger,
    options: KeycloakImportOptions = {},
  ) {
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#alertAfterMs = options.alertAfterMs ?? 5 * 60 * 1000;
    this.#pageSize = options.pageSize ?? 100;
  }

  start(intervalMs: number): void {
    const tick = () => {
      this.#running ??= this.runOnce().finally(() => {
        this.#running = undefined;
      });
    };
    tick();
    this.#timer = setInterval(tick, intervalMs);
    this.#timer.unref();
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    await this.#running;
  }

  /** One pass over every realm; one gateway replica at a time (a session advisory lock). */
  async runOnce(): Promise<void> {
    const client = await this.pool.connect();
    try {
      const leader = await client.query<{ ok: boolean }>(
        `SELECT pg_try_advisory_lock(${LEADER_LOCK}) AS ok`,
      );
      if (!leader.rows[0]?.ok) return;
      try {
        for (const realm of this.realms) {
          if (realm.audit) await this.#importRealm(realm, realm.audit);
        }
      } finally {
        await client.query(`SELECT pg_advisory_unlock(${LEADER_LOCK})`);
      }
    } finally {
      client.release();
    }
  }

  async #importRealm(
    realm: AdminRealm,
    reader: { clientId: string; clientSecret: string },
  ): Promise<void> {
    await this.pool.query(
      'INSERT INTO audit_import_state (realm) VALUES ($1) ON CONFLICT DO NOTHING',
      [realm.org],
    );
    const state = (
      await this.pool.query<ImportState>(
        'SELECT events_after, admin_events_after, failing_since, alerted FROM audit_import_state WHERE realm = $1',
        [realm.org],
      )
    ).rows[0];
    if (!state) return;
    const eventsAfter = Number(state.events_after);
    const adminAfter = Number(state.admin_events_after);
    try {
      const token = await this.#token(realm, reader);
      const admin = realm.issuer.replace('/realms/', '/admin/realms/');
      const events = (await this.#page(`${admin}/events`, token, eventsAfter, userEventSchema))
        // The import's own sign-ins (every minute) are not audit events.
        .filter((event) => event.clientId !== reader.clientId);
      const adminEvents = await this.#page(
        `${admin}/admin-events`,
        token,
        adminAfter,
        adminEventSchema,
      );
      const audits = [
        ...events.map((event) => userEventToAudit(realm, event)),
        ...adminEvents.map((event) => adminEventToAudit(realm, event)),
      ].sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
      for (const event of audits) {
        const seen = await this.pool.query(
          'SELECT 1 FROM audit_log WHERE chain = $1 AND external_id = $2',
          [event.chain, event.externalId],
        );
        if (!seen.rowCount) await recordAudit(this.pool, event);
      }
      const newEventsAfter = Math.max(eventsAfter, ...events.map((event) => event.time));
      const newAdminAfter = Math.max(adminAfter, ...adminEvents.map((event) => event.time));
      if (state.failing_since) {
        // Back after a failure: the platform chain records the gap and what this pass covered.
        await recordAudit(this.pool, {
          chain: PLATFORM_CHAIN,
          tenant: '*',
          actor: { kind: 'system', issuer: 'system', subject: 'audit-import' },
          action: 'audit.import.recovered',
          result: 'success',
          source: 'system',
          details: {
            realm: realm.org,
            failingSince: state.failing_since.toISOString(),
            recoveredAt: new Date(this.#now()).toISOString(),
            coveredFrom: new Date(Math.min(eventsAfter, adminAfter)).toISOString(),
            coveredTo: new Date(Math.max(newEventsAfter, newAdminAfter)).toISOString(),
            imported: audits.length,
          },
        });
      }
      await this.pool.query(
        `UPDATE audit_import_state
            SET events_after = $2, admin_events_after = $3, last_success = $4,
                failing_since = NULL, alerted = false
          WHERE realm = $1`,
        [realm.org, newEventsAfter, newAdminAfter, new Date(this.#now())],
      );
    } catch (error) {
      const since = state.failing_since ?? new Date(this.#now());
      const alert = !state.alerted && this.#now() - since.getTime() >= this.#alertAfterMs;
      if (alert) {
        this.log.error(
          {
            alert: 'audit_import_failing',
            realm: realm.org,
            failingSince: since.toISOString(),
            err: String(error),
          },
          'audit_import_failing',
        );
      } else {
        this.log.warn({ realm: realm.org, err: String(error) }, 'keycloak event import failed');
      }
      await this.pool.query(
        'UPDATE audit_import_state SET failing_since = $2, alerted = $3 WHERE realm = $1',
        [realm.org, since, state.alerted || alert],
      );
    }
  }

  async #token(
    realm: AdminRealm,
    reader: { clientId: string; clientSecret: string },
  ): Promise<string> {
    const answer = await this.#fetch(`${realm.issuer}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: reader.clientId,
        client_secret: reader.clientSecret,
      }),
    });
    if (!answer.ok) throw new Error(`token endpoint answered ${String(answer.status)}`);
    const body = z.object({ access_token: z.string() }).parse(await answer.json());
    return body.access_token;
  }

  /** Newest first from Keycloak: pages until the cursor (ties re-read, deduplicated by id). */
  async #page<T extends { time: number }>(
    url: string,
    token: string,
    after: number,
    schema: z.ZodType<T>,
  ): Promise<T[]> {
    const found: T[] = [];
    for (let first = 0; ; first += this.#pageSize) {
      const answer = await this.#fetch(
        `${url}?first=${String(first)}&max=${String(this.#pageSize)}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (!answer.ok) throw new Error(`${url} answered ${String(answer.status)}`);
      const page = z.array(schema).parse(await answer.json());
      const fresh = page.filter((event) => event.time >= after);
      found.push(...fresh);
      if (page.length < this.#pageSize || fresh.length < page.length) return found;
    }
  }
}
