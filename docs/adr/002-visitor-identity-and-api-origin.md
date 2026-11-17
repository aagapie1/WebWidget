# ADR 002 — Anonymous visitor identity and origin check on /api/\*

Status: accepted (E1) · 2026-11-17

## Visitor identity

- The gateway issues a random UUID in a signed cookie `__Host-wv` (`HttpOnly`, `Secure`,
  `SameSite=None`, `Partitioned`, `Path=/`, 180 days). Signing uses `VISITOR_COOKIE_SECRET`;
  no server-side state, so replicas stay stateless (rule 9).
- The UUID is sent to Dify as `user`. Conversation history (E3) is bound to it.
- A missing, malformed or tampered cookie gets a new id.
- `Partitioned` (CHIPS): the iframe is cross-site to the client's page, so the cookie is a
  third-party cookie. Browsers that block unpartitioned third-party cookies accept partitioned
  ones; the cost is one visitor id per embedding site, which matches one tenant per site.
- The cookie is written as a raw `Set-Cookie` header because the SSE route hijacks the reply
  (the `@fastify/cookie` onSend hook does not run).

To verify in E2 on real browsers: Safari iOS and Firefox strict mode keep the partitioned
cookie inside the iframe. Fallback if not: a visitor token kept in the iframe's memory and
`sessionStorage` (no history in `localStorage`, per CLAUDE.md).

## Origin check

The chat UI runs in an iframe served by the gateway itself, so `fetch('/api/chat')` carries the
gateway's own origin, never the client's site. Therefore:

- `/api/*` accepts only `Origin == PUBLIC_ORIGIN` (requests without `Origin` are rejected). This
  blocks other sites from calling the API directly from a browser.
- `allowedOrigins` of the tenant is enforced where the client's site is visible: when `/w/app`
  is loaded (`Content-Security-Policy: frame-ancestors`, `Referer`) — E2/E5.
