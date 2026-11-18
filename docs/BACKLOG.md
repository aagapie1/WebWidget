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
- **E4b.2** (after E4b.1, before E5) — Version history with differences and restore, JSON export/import (§5.3); audit log screen; tenant administration by super-admin (§5.6); Keycloak on the server, shared with the Dify console SSO (oauth2-proxy). Spec v0.3: docs/specs/widget-E4b-admin-SPEC.md; decisions: ADR 008.
- **E4b** — Proactive message frequency "day" and the full built-in launcher icon set (schema already has both).
- **E4b.2** — Delete uploaded images (`DELETE /admin/api/tenants/:id/assets/:assetId`, spec §8) once no version references them; needs a DELETE grant on `tenant_assets` or a clean-up job run with the owner role.
- **E7** — GDPR notice at first open uses `behavior.privacyPolicyUrl` (already in the E4 schema).
- **E5** — loader.js: put its styles in a constructable stylesheet (`adoptedStyleSheets`) instead of a `<style>` element, so sites with a strict CSP do not need `style-src 'unsafe-inline'` (noted in "Integrare pe site", E4b.1 UX).
