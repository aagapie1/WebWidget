import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import { PLATFORM_CHAIN, recordAudit, type AuditEvent } from './log.js';

/** The chain of a signed-in organisation: its client, or the platform for super-admins. */
export const chainOf = (tenant: string): string => (tenant === '*' ? PLATFORM_CHAIN : tenant);

/**
 * Records events that are not part of a configuration change (sign-in, sign-out, an expired
 * session, an access denied, viewing the log). Configuration changes are written in their own
 * transaction instead (fail closed). Here a write that fails must not hide the answer the user
 * gets (for example a refusal): it is logged as `audit_write_failed` for the alerting, and the
 * request goes on. Without a database (file tenants, no admin API) nothing is recorded.
 */
export class AuditRecorder {
  constructor(
    private readonly pool: pg.Pool | undefined,
    private readonly log: FastifyBaseLogger,
  ) {}

  get enabled(): boolean {
    return this.pool !== undefined;
  }

  async record(event: AuditEvent): Promise<void> {
    if (!this.pool) return;
    try {
      await recordAudit(this.pool, event);
    } catch (error) {
      this.log.error(
        {
          alert: 'audit_write_failed',
          chain: event.chain,
          action: event.action,
          err: String(error),
        },
        'audit_write_failed',
      );
    }
  }

  /** The same event in several chains (a request from one client towards another, for example). */
  async recordIn(
    chainsToWrite: readonly string[],
    event: Omit<AuditEvent, 'chain'>,
  ): Promise<void> {
    for (const chain of new Set(chainsToWrite)) await this.record({ ...event, chain });
  }
}
