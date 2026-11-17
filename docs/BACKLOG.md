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
- **E4b (after E10, last stage)** — Admin interface for per-tenant widget configuration: Keycloak OIDC with roles (`widget-editor`, `widget-admin`, `super-admin`), Postgres drafts / versions / audit log, live preview, publish with hot reload, image upload (PNG/WebP/JPEG only, no SVG, magic bytes, EXIF stripped). Spec: `docs/specs/widget-E4b-admin-SPEC.md`; how E4 prepares it: ADR 007.
- **E7** — GDPR notice at first open uses `behavior.privacyPolicyUrl` (already in the E4 schema).
