# Backlog

Ideas and deferred work, outside the current stage. Each item notes the stage it belongs to.


- **E5** — Redis for rate limiting; `allowedOrigins` check on `/w/app` (Referer) + `frame-ancestors` CSP; masking function for message logs (CNP, phone, email).
- **E5** — Dockerfile (non-root), docker-compose, Traefik labels.
- **NFR** — Prometheus `/metrics`.
- **E3** — Suggested questions as quick-reply buttons under the assistant message (design reference: pill buttons inside the welcome bubble).
- **E4** — Assistant avatar image/logo instead of the generic icon; header subtitle text and gradient colors configurable per tenant.
- **E7** — Unread badge on the launcher (red counter, also announced to screen readers).
- **E8/E9** — Composer toolbar (microphone, attachment) next to the send button.
- **E5 (before any public demo)** — Rate limiting per IP and per visitor (Redis) and a message-length/new-conversation cap, then a public feedback demo on `https://aagapie1.github.io/sbsweb/` (add `https://aagapie1.github.io` to the demo tenant's `allowedOrigins`; the gateway needs a public HTTPS host, e.g. Docker + Traefik next to the pilot Dify). Postponed on 2026-11-17 so the pilot Dify is not exposed without protection.
