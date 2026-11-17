# Backlog

Ideas and deferred work, outside the current stage. Each item notes the stage it belongs to.

- **E2** — Stop generation: `POST /api/chat/:taskId/stop` → Dify `POST /chat-messages/{task_id}/stop`. When the browser disconnects mid-stream, also call Dify stop (aborting the upstream HTTP request does not necessarily stop generation).
- **E3** — Conversation title set locally (first ~50 chars of the first question) via `POST /conversations/{id}/name` with `auto_generate: false`, never via the model (SPEC §4).
- **E5** — Redis for rate limiting; `allowedOrigins` check on `/w/app` (Referer) + `frame-ancestors` CSP; masking function for message logs (CNP, phone, email).
- **E5** — Dockerfile (non-root), docker-compose, Traefik labels.
- **NFR** — Prometheus `/metrics`.
