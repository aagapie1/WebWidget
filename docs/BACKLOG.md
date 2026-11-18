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
- **E5 — MANDATORY before the first public client** — loader.js styles without `style-src 'unsafe-inline'`: Constructable Stylesheets (`adoptedStyleSheets`) in the Shadow DOM, with a fallback CSS file served by the gateway. Decision and verification (strict-CSP e2e page, 3 browsers): ADR 010. Then "Integrare pe site" lists `style-src <gateway>` and drops the `'unsafe-inline'` note.
- **Test tooling** — Firefox crashes ("Page crashed") while axe-core 4.14 scans an admin Aspect section (identity, launcher, window, colors) as a whole; several rules trigger it, color-contrast alone does not, and every field passes on its own; the pages work in Firefox. The editor axe test scans those sections piece by piece in Firefox (all rules), whole elsewhere; a piece that still crashes (seen once: the "same side" switch row, on) is retried once, then reported as a `firefox-axe-crash` annotation instead of a failure. Reproduce with a minimal page and report to axe-core / Mozilla; scan whole sections again when fixed.
