import type pg from 'pg';
import { chainHash } from './chain.js';

/** The platform's own chain: system events and events that belong to no client (K2). */
export const PLATFORM_CHAIN = 'platform';

export type AuditResult = 'success' | 'denied' | 'failed';

/** Who acted: a signed-in user, or the system (seed, cleanup, import). */
export interface AuditActor {
  kind: 'user' | 'system';
  issuer: string;
  subject: string;
  name?: string | undefined;
  email?: string | undefined;
  role?: string | undefined;
  /** The organisation (realm) the user signed in with. */
  org?: string | undefined;
  /** How they signed in: `local` (a Keycloak account) or the institution's IdP alias. */
  source?: string | undefined;
}

/** Where from: after E5 D1 the IP can be trusted. The session is only ever stored as a hash. */
export interface AuditContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
  sessionHash?: string | undefined;
  requestId?: string | undefined;
}

export interface AuditEvent {
  /** A client's id, or PLATFORM_CHAIN. */
  chain: string;
  /** The client the event is about (`*` for the platform). */
  tenant: string;
  actor: AuditActor;
  context?: AuditContext | undefined;
  action: string;
  section?: string | undefined;
  result: AuditResult;
  /** Why it was denied or failed: forbidden, draft_conflict, invalid, rate_limited… */
  reason?: string | undefined;
  /** The published version it produced or concerns. */
  version?: number | undefined;
  /** Allowed domains and other security-relevant settings. */
  sensitive?: boolean | undefined;
  details?: Record<string, unknown> | undefined;
  source?: 'gateway' | 'keycloak' | 'system' | undefined;
  /** Keycloak's event id, for imported events (imported once). */
  externalId?: string | undefined;
  /** When it happened; now by default (Keycloak events keep their own time). */
  at?: Date | undefined;
}

export interface StoredAuditEvent extends Required<
  Pick<AuditEvent, 'chain' | 'tenant' | 'actor' | 'action' | 'result'>
> {
  id: number;
  seq: number | null;
  at: string;
  context: AuditContext;
  section: string | undefined;
  reason: string | undefined;
  version: number | undefined;
  sensitive: boolean;
  details: Record<string, unknown>;
  source: string;
  externalId: string | undefined;
  prevHash: string | undefined;
  hash: string | undefined;
}

const USER_AGENT_LIMIT = 512;

/** The record as it is hashed: the same fields, rebuilt from the row by `verify`. */
export function hashedRecord(event: {
  chain: string;
  seq: number;
  at: string;
  tenant: string;
  actor: AuditActor;
  context: AuditContext;
  action: string;
  section?: string | undefined;
  result: AuditResult;
  reason?: string | undefined;
  version?: number | undefined;
  sensitive: boolean;
  details: Record<string, unknown>;
  source: string;
  externalId?: string | undefined;
}): unknown {
  return event;
}

/**
 * Appends one event to its chain, inside the caller's transaction (so that a published version and
 * its audit record commit together). Inserts into one chain are serialised by a transaction-level
 * advisory lock; different clients' chains do not wait on each other (K2).
 */
export async function appendAudit(
  client: pg.PoolClient,
  event: AuditEvent,
): Promise<StoredAuditEvent> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('audit:' || $1, 0))`, [
    event.chain,
  ]);
  const last = await client.query<{ seq: string; hash: string }>(
    'SELECT seq, hash FROM audit_log WHERE chain = $1 AND seq IS NOT NULL ORDER BY seq DESC LIMIT 1',
    [event.chain],
  );
  const previous = last.rows[0];
  const seq = previous ? Number(previous.seq) + 1 : 1;
  const prevHash = previous?.hash ?? '';
  const at = (event.at ?? new Date()).toISOString();
  const context: AuditContext = {
    ...(event.context?.ip ? { ip: event.context.ip } : {}),
    ...(event.context?.userAgent
      ? { userAgent: event.context.userAgent.slice(0, USER_AGENT_LIMIT) }
      : {}),
    ...(event.context?.sessionHash ? { sessionHash: event.context.sessionHash } : {}),
    ...(event.context?.requestId ? { requestId: event.context.requestId } : {}),
  };
  const record = {
    chain: event.chain,
    seq,
    at,
    tenant: event.tenant,
    actor: event.actor,
    context,
    action: event.action,
    section: event.section,
    result: event.result,
    reason: event.reason,
    version: event.version,
    sensitive: event.sensitive ?? false,
    details: event.details ?? {},
    source: event.source ?? 'gateway',
    externalId: event.externalId,
  };
  const hash = chainHash(prevHash, hashedRecord(record));
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO audit_log (
       chain, seq, at, tenant_id, actor_kind, actor_issuer, actor_subject, actor_name, actor_email,
       actor_role, actor_org, actor_source, ip, user_agent, session_hash, request_id, action,
       section, result, reason, version, sensitive, details, source, external_id, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
             $20, $21, $22, $23, $24, $25, $26, $27)
     RETURNING id`,
    [
      record.chain,
      seq,
      at,
      record.tenant,
      record.actor.kind,
      record.actor.issuer,
      record.actor.subject,
      record.actor.name ?? null,
      record.actor.email ?? null,
      record.actor.role ?? null,
      record.actor.org ?? null,
      record.actor.source ?? null,
      context.ip ?? null,
      context.userAgent ?? null,
      context.sessionHash ?? null,
      context.requestId ?? null,
      record.action,
      record.section ?? null,
      record.result,
      record.reason ?? null,
      record.version ?? null,
      record.sensitive,
      JSON.stringify(record.details),
      record.source,
      record.externalId ?? null,
      prevHash,
      hash,
    ],
  );
  return {
    ...record,
    id: Number(inserted.rows[0]?.id),
    seq,
    reason: record.reason,
    section: record.section,
    version: record.version,
    externalId: record.externalId,
    prevHash,
    hash,
  };
}

/** Column list shared by the readers. */
export const AUDIT_COLUMNS = `id, chain, seq, at, tenant_id, actor_kind, actor_issuer, actor_subject,
  actor_name, actor_email, actor_role, actor_org, actor_source, ip, user_agent, session_hash,
  request_id, action, section, result, reason, version, sensitive, details, source, external_id,
  prev_hash, hash`;

export interface AuditRow {
  id: string;
  chain: string;
  seq: string | null;
  at: Date;
  tenant_id: string;
  actor_kind: string;
  actor_issuer: string;
  actor_subject: string;
  actor_name: string | null;
  actor_email: string | null;
  actor_role: string | null;
  actor_org: string | null;
  actor_source: string | null;
  ip: string | null;
  user_agent: string | null;
  session_hash: string | null;
  request_id: string | null;
  action: string;
  section: string | null;
  result: AuditResult;
  reason: string | null;
  version: number | null;
  sensitive: boolean;
  details: Record<string, unknown>;
  source: string;
  external_id: string | null;
  prev_hash: string | null;
  hash: string | null;
}

const opt = <T>(value: T | null): T | undefined => (value === null ? undefined : value);

export function fromRow(row: AuditRow): StoredAuditEvent {
  return {
    id: Number(row.id),
    chain: row.chain,
    seq: row.seq === null ? null : Number(row.seq),
    at: row.at.toISOString(),
    tenant: row.tenant_id,
    actor: {
      kind: row.actor_kind === 'system' ? 'system' : 'user',
      issuer: row.actor_issuer,
      subject: row.actor_subject,
      name: opt(row.actor_name),
      email: opt(row.actor_email),
      role: opt(row.actor_role),
      org: opt(row.actor_org),
      source: opt(row.actor_source),
    },
    context: {
      ip: opt(row.ip),
      userAgent: opt(row.user_agent),
      sessionHash: opt(row.session_hash),
      requestId: opt(row.request_id),
    },
    action: row.action,
    section: opt(row.section),
    result: row.result,
    reason: opt(row.reason),
    version: opt(row.version),
    sensitive: row.sensitive,
    details: row.details,
    source: row.source,
    externalId: opt(row.external_id),
    prevHash: opt(row.prev_hash),
    hash: opt(row.hash),
  };
}

export interface ChainProblem {
  chain: string;
  seq: number;
  problem: 'hash' | 'link' | 'gap' | 'anchor';
}

export interface ChainReport {
  chain: string;
  records: number;
  /** Where verification started: the first record, or the last purge's anchor (K3). */
  from: { seq: number; prevHash: string };
  lastSeq: number;
  lastHash: string;
  problems: ChainProblem[];
}

/**
 * Recomputes a chain from the database (K2/K3): every record's hash from its columns, every link to
 * the previous record, no missing sequence number. A chain whose oldest records were purged starts
 * from the anchor that the `retention.purge` event recorded.
 */
export async function verifyChain(pool: pg.Pool, chain: string): Promise<ChainReport> {
  const rows = (
    await pool.query<AuditRow>(
      `SELECT ${AUDIT_COLUMNS} FROM audit_log WHERE chain = $1 AND seq IS NOT NULL ORDER BY seq`,
      [chain],
    )
  ).rows.map(fromRow);
  const problems: ChainProblem[] = [];
  const first = rows[0];
  // After a purge, the oldest remaining record links to the last deleted one (K3).
  const purges = rows.filter((row) => row.action === 'retention.purge');
  const anchor = purges.at(-1)?.details as
    { lastDeletedSeq?: number; lastDeletedHash?: string } | undefined;
  const from =
    first && first.seq !== 1 && anchor?.lastDeletedHash
      ? { seq: (anchor.lastDeletedSeq ?? 0) + 1, prevHash: anchor.lastDeletedHash }
      : { seq: 1, prevHash: '' };
  let expectedSeq = from.seq;
  let previousHash = from.prevHash;
  for (const row of rows) {
    const seq = row.seq ?? 0;
    if (seq !== expectedSeq) {
      problems.push({ chain, seq, problem: seq === rows[0]?.seq ? 'anchor' : 'gap' });
    }
    if ((row.prevHash ?? '') !== previousHash) problems.push({ chain, seq, problem: 'link' });
    const recomputed = chainHash(
      row.prevHash ?? '',
      hashedRecord({
        chain: row.chain,
        seq,
        at: row.at,
        tenant: row.tenant,
        actor: row.actor,
        context: row.context,
        action: row.action,
        section: row.section,
        result: row.result,
        reason: row.reason,
        version: row.version,
        sensitive: row.sensitive,
        details: row.details,
        source: row.source,
        externalId: row.externalId,
      }),
    );
    if (recomputed !== row.hash) problems.push({ chain, seq, problem: 'hash' });
    previousHash = row.hash ?? '';
    expectedSeq = seq + 1;
  }
  const last = rows.at(-1);
  return {
    chain,
    records: rows.length,
    from,
    lastSeq: last?.seq ?? 0,
    lastHash: last?.hash ?? '',
    problems,
  };
}

/** Every chain in the database. */
export async function chains(pool: pg.Pool): Promise<string[]> {
  return (
    await pool.query<{ chain: string }>(
      'SELECT DISTINCT chain FROM audit_log WHERE seq IS NOT NULL ORDER BY chain',
    )
  ).rows.map((row) => row.chain);
}

/** Appends one event in its own transaction (events outside a configuration change). */
export async function recordAudit(pool: pg.Pool, event: AuditEvent): Promise<StoredAuditEvent> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stored = await appendAudit(client, event);
    await client.query('COMMIT');
    return stored;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
