import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** `__Host-` prefix: Secure, Path=/, no Domain — the browser enforces it. */
export const VISITOR_COOKIE = '__Host-wv';
/**
 * Fallback for browsers that block cookies in third-party iframes (Safari/WebKit, ADR 006):
 * the same signed value, returned in this response header and sent back by the iframe, which
 * keeps it in memory only.
 */
export const VISITOR_HEADER = 'x-visitor-token';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Returns the anonymous visitor id from the signed cookie (or the fallback header), issuing a
 * new one when missing or tampered with. The id is sent to Dify as `user`; conversation history
 * is bound to it (ADR 002).
 */
export function resolveVisitor(
  request: FastifyRequest,
  reply: FastifyReply,
  /** Cookie lifetime, per tenant (`visitorCookieDays`, ADR 005). */
  maxAgeDays: number,
): string {
  const existing = readVisitor(request);
  if (existing) return existing;

  const visitorId = randomUUID();
  const { server } = request;
  const signed = server.signCookie(visitorId);
  // Serialized here rather than with reply.setCookie(): the chat route hijacks the reply to
  // stream SSE, which skips the onSend hook where @fastify/cookie writes Set-Cookie.
  const cookie = server.serializeCookie(VISITOR_COOKIE, signed, {
    httpOnly: true,
    secure: true,
    // The chat runs in a third-party iframe on the client's site.
    sameSite: 'none',
    // CHIPS: a cookie partitioned per embedding site, accepted where unpartitioned
    // third-party cookies are blocked (ADR 002).
    partitioned: true,
    path: '/',
    maxAge: maxAgeDays * 24 * 60 * 60,
  });
  reply.header('set-cookie', cookie);
  reply.header(VISITOR_HEADER, signed);
  return visitorId;
}

/** The visitor id from a valid signed cookie or fallback header; never issues one. */
export function readVisitor(request: FastifyRequest): string | undefined {
  const fromCookie = unsign(request, request.cookies[VISITOR_COOKIE]);
  if (fromCookie) return fromCookie;
  const header = request.headers[VISITOR_HEADER];
  return unsign(request, typeof header === 'string' ? header : undefined);
}

function unsign(request: FastifyRequest, raw: string | undefined): string | undefined {
  if (raw === undefined || raw.length > 200) return undefined;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid && UUID.test(unsigned.value) ? unsigned.value : undefined;
}
