import { createHash } from 'node:crypto';
import type { AuditActor, AuditContext } from '../audit/log.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AdminSession } from './sessions.js';

const STATUS = {
  unauthenticated: 401,
  forbidden: 403,
  forbidden_origin: 403,
  csrf: 403,
  rate_limited: 429,
  not_found: 404,
  invalid_request: 400,
  no_draft: 409,
  conflict: 409,
  asset_in_use: 409,
  draft_conflict: 409,
  invalid_config: 422,
  too_large: 413,
  unsupported_type: 415,
  invalid_image: 422,
  internal_error: 500,
} as const;

export type AdminErrorCode = keyof typeof STATUS;

/** Admin API errors: a stable code (the admin interface translates it) and optional details. */
export function adminError(
  reply: FastifyReply,
  code: AdminErrorCode,
  details: Record<string, unknown> = {},
): FastifyReply {
  return reply.code(STATUS[code]).send({ error: { code, ...details } });
}

const sessions = new WeakMap<FastifyRequest, { session: AdminSession; id: string }>();

/** Set by the guard: the session and its id (the cookie value). */
export function attachSession(request: FastifyRequest, session: AdminSession, id: string): void {
  sessions.set(request, { session, id });
}

function attached(request: FastifyRequest): { session: AdminSession; id: string } {
  const entry = sessions.get(request);
  if (!entry) throw new Error('admin route without the session guard');
  return entry;
}

/** The session of an authenticated admin request (set by the guard). */
export function sessionOf(request: FastifyRequest): AdminSession {
  return attached(request).session;
}

/** The session id (binds preview tokens to this session). */
export function sessionIdOf(request: FastifyRequest): string {
  return attached(request).id;
}

/** The hash of a session id as the audit log stores it: never the session itself (B9). */
export const sessionHash = (id: string): string =>
  createHash('sha256').update(id).digest('base64url').slice(0, 22);

/** Where a request comes from (after E5 D1 the IP can be trusted). */
export function auditContextOf(request: FastifyRequest, sessionId?: string): AuditContext {
  const agent = request.headers['user-agent'];
  return {
    ip: request.ip,
    ...(typeof agent === 'string' ? { userAgent: agent } : {}),
    ...(sessionId ? { sessionHash: sessionHash(sessionId) } : {}),
    requestId: request.id,
  };
}

/** The signed-in user as the audit log records them. */
export function auditActorOf(session: Pick<AdminSession, 'identity' | 'org'>): AuditActor {
  const { identity } = session;
  return {
    kind: 'user',
    issuer: identity.issuer,
    subject: identity.subject,
    name: identity.name,
    email: identity.email,
    role: identity.role,
    org: session.org,
    source: identity.source,
  };
}

/** Who acts and from where, for an authenticated admin request. */
export function auditWhoOf(request: FastifyRequest): { actor: AuditActor; context: AuditContext } {
  const { session, id } = attached(request);
  return { actor: auditActorOf(session), context: auditContextOf(request, id) };
}
