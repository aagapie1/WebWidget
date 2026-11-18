import type { FastifyReply, FastifyRequest } from 'fastify';
import { can, type AdminAction } from './identity.js';
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

const sessions = new WeakMap<FastifyRequest, AdminSession>();

export function attachSession(request: FastifyRequest, session: AdminSession): void {
  sessions.set(request, session);
}

/** The session of an authenticated admin request (set by the guard). */
export function sessionOf(request: FastifyRequest): AdminSession {
  const session = sessions.get(request);
  if (!session) throw new Error('admin route without the session guard');
  return session;
}

/** Server-side authorization for a tenant (spec §4.3). Replies 403 and returns false if denied. */
export function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  tenant: string,
  action: AdminAction,
): boolean {
  if (can(sessionOf(request).identity, tenant, action)) return true;
  void adminError(reply, 'forbidden');
  return false;
}
