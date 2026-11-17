# Backlog

Ideas and deferred work, outside the current stage. Each item notes the stage it belongs to.

- **E3** — Conversation title set locally (first ~50 chars of the first question) via `POST /conversations/{id}/name` with `auto_generate: false`, never via the model (SPEC §4).
- **E5** — Redis for rate limiting; `allowedOrigins` check on `/w/app` (Referer) + `frame-ancestors` CSP; masking function for message logs (CNP, phone, email).
- **E5** — Dockerfile (non-root), docker-compose, Traefik labels.
- **NFR** — Prometheus `/metrics`.
- **E3** — Suggested questions as quick-reply buttons under the assistant message (design reference: pill buttons inside the welcome bubble).
- **E4** — Assistant avatar image/logo instead of the generic icon; header subtitle text and gradient colors configurable per tenant.
- **E7** — Unread badge on the launcher (red counter, also announced to screen readers).
- **E8/E9** — Composer toolbar (microphone, attachment) next to the send button.
