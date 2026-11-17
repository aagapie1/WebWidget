import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** `__Host-` prefix: Secure, Path=/, no Domain — the browser enforces it. */
export const VISITOR_COOKIE = '__Host-wv';
const MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Returns the anonymous visitor id from the signed cookie, issuing a new one when missing or
 * tampered with. The id is sent to Dify as `user`; conversation history is bound to it (ADR 002).
 */
export function resolveVisitor(request: FastifyRequest, reply: FastifyReply): string {
  const raw = request.cookies[VISITOR_COOKIE];
  if (raw !== undefined) {
    const unsigned = request.unsignCookie(raw);
    if (unsigned.valid && UUID.test(unsigned.value)) {
      return unsigned.value;
    }
  }

  const visitorId = randomUUID();
  // Serialized here rather than with reply.setCookie(): the chat route hijacks the reply to
  // stream SSE, which skips the onSend hook where @fastify/cookie writes Set-Cookie.
  const { server } = request;
  const cookie = server.serializeCookie(VISITOR_COOKIE, server.signCookie(visitorId), {
    httpOnly: true,
    secure: true,
    // The chat runs in a third-party iframe on the client's site.
    sameSite: 'none',
    // CHIPS: a cookie partitioned per embedding site, accepted where unpartitioned
    // third-party cookies are blocked (ADR 002).
    partitioned: true,
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
  reply.header('set-cookie', cookie);
  return visitorId;
}
