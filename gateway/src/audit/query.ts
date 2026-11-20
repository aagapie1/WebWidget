import type pg from 'pg';
import { z } from 'zod';
import { canonicalJson } from './chain.js';
import { AUDIT_COLUMNS, fromRow, type AuditRow, type StoredAuditEvent } from './log.js';

/** Filters of the "Jurnal de audit" screen and of its exports (E5 B9). */
export const auditFilterSchema = z.object({
  /** ISO date (`2026-11-20`) or date-time; `to` is exclusive. */
  from: z.iso.datetime({ offset: true }).or(z.iso.date()).optional(),
  to: z.iso.datetime({ offset: true }).or(z.iso.date()).optional(),
  /** A name, an e-mail or a Keycloak user id (contains, case-insensitive). */
  user: z.string().trim().max(100).optional(),
  /** An action, or a prefix ending in `*` (`keycloak.*`, `auth.*`). */
  action: z
    .string()
    .trim()
    .max(100)
    .regex(/^[a-z_.]*\*?$/)
    .optional(),
  section: z.string().trim().max(64).optional(),
  result: z.enum(['success', 'denied', 'failed']).optional(),
  /** Free text over who, action, section, reason and the details (diff values included). */
  q: z.string().trim().max(200).optional(),
});
export type AuditFilters = z.infer<typeof auditFilterSchema>;

const dayStart = (value: string): string => (value.length === 10 ? `${value}T00:00:00Z` : value);

function where(chain: string, filters: AuditFilters): { sql: string; values: unknown[] } {
  const values: unknown[] = [chain];
  const clauses = ['chain = $1'];
  const add = (clause: (index: string) => string, value: unknown) => {
    values.push(value);
    clauses.push(clause(`$${String(values.length)}`));
  };
  if (filters.from) add((i) => `at >= ${i}`, dayStart(filters.from));
  if (filters.to) add((i) => `at < ${i}`, dayStart(filters.to));
  if (filters.user) {
    add(
      (i) => `(actor_name ILIKE ${i} OR actor_email ILIKE ${i} OR actor_subject ILIKE ${i})`,
      `%${escapeLike(filters.user)}%`,
    );
  }
  if (filters.action) {
    if (filters.action.endsWith('*')) {
      add((i) => `action LIKE ${i}`, `${escapeLike(filters.action.slice(0, -1))}%`);
    } else {
      add((i) => `action = ${i}`, filters.action);
    }
  }
  if (filters.section) add((i) => `section ILIKE ${i}`, `%${escapeLike(filters.section)}%`);
  if (filters.result) add((i) => `result = ${i}`, filters.result);
  if (filters.q) {
    add(
      (i) =>
        `(actor_name ILIKE ${i} OR actor_email ILIKE ${i} OR action ILIKE ${i} OR section ILIKE ${i}
          OR reason ILIKE ${i} OR details::text ILIKE ${i} OR ip ILIKE ${i})`,
      `%${escapeLike(filters.q)}%`,
    );
  }
  return { sql: clauses.join(' AND '), values };
}

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** One page, newest first; `before` is the sequence number to continue from. */
export async function listAudit(
  pool: pg.Pool,
  chain: string,
  filters: AuditFilters,
  page: { before?: number | undefined; limit: number },
): Promise<{ events: StoredAuditEvent[]; nextBefore: number | undefined }> {
  const { sql, values } = where(chain, filters);
  const keyset = page.before === undefined ? '' : ` AND seq < $${String(values.length + 1)}`;
  const rows = await pool.query<AuditRow>(
    `SELECT ${AUDIT_COLUMNS} FROM audit_log WHERE ${sql}${keyset} AND seq IS NOT NULL
      ORDER BY seq DESC LIMIT ${String(page.limit + 1)}`,
    page.before === undefined ? values : [...values, page.before],
  );
  const events = rows.rows.slice(0, page.limit).map(fromRow);
  return {
    events,
    nextBefore: rows.rows.length > page.limit ? (events.at(-1)?.seq ?? undefined) : undefined,
  };
}

/** For exports: oldest first (the chain's order), at most `limit` records. */
export async function exportAudit(
  pool: pg.Pool,
  chain: string,
  filters: AuditFilters,
  limit: number,
): Promise<StoredAuditEvent[]> {
  const { sql, values } = where(chain, filters);
  const rows = await pool.query<AuditRow>(
    `SELECT ${AUDIT_COLUMNS} FROM audit_log WHERE ${sql} AND seq IS NOT NULL
      ORDER BY seq LIMIT ${String(limit)}`,
    values,
  );
  return rows.rows.map(fromRow);
}

const romanianTime = new Intl.DateTimeFormat('ro-RO', {
  timeZone: 'Europe/Bucharest',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
/** The time in Romania, for people (the database and the hashes keep UTC). */
export const inRomania = (iso: string): string => romanianTime.format(new Date(iso));

export interface ExportHeader {
  generatedBy: { name: string; email?: string | undefined; role: string; org: string };
  generatedAt: string;
  chain: string;
  filters: AuditFilters;
  count: number;
  /** True when no filter but the period was used: the records are a contiguous part of the chain. */
  contiguous: boolean;
  /** The chain position and hash the export starts from (the first record's `prevHash`). */
  startsAfter: { seq: number; hash: string } | null;
  lastHash: string | null;
  verification: string;
}

const VERIFICATION =
  'Each record: hash = SHA-256(prevHash + "\\n" + canonical JSON of the record without prevHash and hash; ' +
  "keys sorted, null and missing fields left out). A contiguous export: each prevHash equals the previous record's hash.";

export function exportHeader(
  generatedBy: ExportHeader['generatedBy'],
  chain: string,
  filters: AuditFilters,
  events: readonly StoredAuditEvent[],
  now: Date = new Date(),
): ExportHeader {
  const first = events[0];
  const contiguous = Object.keys(filters).every((key) => key === 'from' || key === 'to');
  return {
    generatedBy,
    generatedAt: now.toISOString(),
    chain,
    filters,
    count: events.length,
    contiguous,
    startsAfter: first ? { seq: (first.seq ?? 1) - 1, hash: first.prevHash ?? '' } : null,
    lastHash: events.at(-1)?.hash ?? null,
    verification: VERIFICATION,
  };
}

/** The record as hashed (what an auditor recomputes), with its links. */
export function hashedView(event: StoredAuditEvent): Record<string, unknown> {
  return {
    record: {
      chain: event.chain,
      seq: event.seq,
      at: event.at,
      tenant: event.tenant,
      actor: event.actor,
      context: event.context,
      action: event.action,
      section: event.section,
      result: event.result,
      reason: event.reason,
      version: event.version,
      sensitive: event.sensitive,
      details: event.details,
      source: event.source,
      externalId: event.externalId,
    },
    atRomania: inRomania(event.at),
    prevHash: event.prevHash,
    hash: event.hash,
  };
}

const CSV_COLUMNS = [
  'seq',
  'at_utc',
  'at_romania',
  'action',
  'section',
  'result',
  'reason',
  'version',
  'sensitive',
  'actor_name',
  'actor_email',
  'actor_role',
  'actor_org',
  'actor_source',
  'actor_subject',
  'ip',
  'user_agent',
  'session_hash',
  'request_id',
  'details',
  'prev_hash',
  'hash',
] as const;

const csvCell = (value: string | number | boolean | null | undefined): string => {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** CSV for spreadsheets: the header as `#` lines, then one row per record. */
export function toCsv(header: ExportHeader, events: readonly StoredAuditEvent[]): string {
  const lines = [
    `# Jurnal de audit — ${header.chain}`,
    `# generat de: ${header.generatedBy.name}${header.generatedBy.email ? ` <${header.generatedBy.email}>` : ''} (${header.generatedBy.role}, ${header.generatedBy.org})`,
    `# generat la: ${header.generatedAt} (${inRomania(header.generatedAt)} ora României)`,
    `# filtre: ${canonicalJson(header.filters)}`,
    `# înregistrări: ${String(header.count)}; continuu: ${header.contiguous ? 'da' : 'nu'}`,
    `# începe după: ${header.startsAfter ? `seq ${String(header.startsAfter.seq)} hash ${header.startsAfter.hash || '(începutul lanțului)'}` : '-'}`,
    `# ultimul hash: ${header.lastHash ?? '-'}`,
    `# verificare: ${header.verification}`,
    CSV_COLUMNS.join(','),
  ];
  for (const event of events) {
    lines.push(
      [
        event.seq,
        event.at,
        inRomania(event.at),
        event.action,
        event.section,
        event.result,
        event.reason,
        event.version,
        event.sensitive,
        event.actor.name,
        event.actor.email,
        event.actor.role,
        event.actor.org,
        event.actor.source,
        event.actor.subject,
        event.context.ip,
        event.context.userAgent,
        event.context.sessionHash,
        event.context.requestId,
        canonicalJson(event.details),
        event.prevHash,
        event.hash,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  // A BOM so that spreadsheet programs read the Romanian letters as UTF-8.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
