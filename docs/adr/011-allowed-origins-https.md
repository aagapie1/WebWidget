# ADR 011 — Allowed origins: https only, outside local development

Date: 2026-11-18. Status: accepted (E4b.1 UX 14).

## Context

`allowedOrigins` decides where the widget runs (Origin check, `frame-ancestors`). Until now any
bare origin was accepted, `http://` included. A public site served over plain http would expose
the visitors' conversations, and an http entry is almost always a typing mistake.

## Decision

- The tenant schema accepts `https://` origins, and `http://` only for `localhost`,
  `127.0.0.1` and `[::1]` (development, e2e). The check is in the gateway schema, so it applies
  to YAML files, the admin API and the admin's own validation alike. Its message is a constant
  (`ORIGIN_HTTPS_MESSAGE`) that the admin translates.
- Existing tenant files stay valid: all of them use https or localhost (`pnpm config:check`).
- In the admin, the domains are a list (one field per domain, errors on their row, a
  confirmation before removing one). Editors no longer see the area; the API already refused
  their changes (403).

## Consequences

- A staging site on plain http on another host must move to https, or be reached through
  localhost. If that turns out to be needed, add an explicit per-environment exception rather
  than relaxing the rule.
