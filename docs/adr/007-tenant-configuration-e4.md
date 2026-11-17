# ADR 007 — Per-tenant configuration (white-label) and the path to E4b

Status: accepted (E4) · 2026-11-17

## Schema

- One versioned Zod schema (`schemaVersion: 1`) in `gateway/src/config/schema.ts` is the single
  source of truth for a tenant's configuration. Sections (they mirror the E4b admin form, §5.1):
  - **identity**: assistant name, logo, assistant avatar, user avatar (image or none);
  - **launcher**: icon, position (`bottom-right` / `bottom-left`), offsets;
  - **window**: width, height (desktop; full screen on phones);
  - **theme**: colors (header gradient, text on accent, links, assistant / user bubbles, buttons);
  - **texts**: overrides per language (`ro`, `en`) of known UI keys; **unknown keys are a
    validation error**. The welcome message and the input placeholder are texts;
  - **proactive**: enabled, text per language, delay in seconds, `frequency` (`session`
    implemented; `day` reserved, rejected for now), `showOnMobile` (default false);
  - **citations**: document title mapping, snippets on/off (from E3);
  - **behavior**: suggested questions after an answer (default off), visitor cookie days, privacy
    policy link (used by E7);
  - **feedback** retention (E3) and **allowedOrigins**.
- No secrets: the Dify key is referenced by environment variable name (`difyApiKeyEnv`) only.
  `${VAR}` interpolation is allowed for non-secret values (e.g. the Dify URL).

## Validation and accessibility

- Contrast is checked by the schema (WCAG 2.1: 4.5:1 for text, 3:1 for UI components) for every
  text/background pair the widget renders. A failure names the pair and the ratio.
- Assets (logo, avatars, launcher icon) are files in `config/tenants/<id>/assets/`, checked for
  extension and size (PNG, JPEG, WebP, SVG ≤ 200 KB). SVG is accepted **only from the
  repository** (reviewed in a pull request) and served with `Content-Type: image/svg+xml`,
  `X-Content-Type-Options: nosniff` and
  `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`; the widget
  only uses it in `<img>`. Asset URLs carry a content hash and are cached as immutable.
- `pnpm config:check` validates every tenant file (structure, contrast, texts, assets) without
  needing secrets; it runs in CI and blocks a deploy with an invalid configuration.

## Loading, fallback and hot reload

- The gateway reads tenants through a `TenantSource` interface. E4 implements
  `FileTenantSource` (YAML files, `fs.watch`). The registry is updated in place, so routes always
  see the current configuration.
- The gateway is multi-tenant and never stops because of one tenant:
  - an invalid file at startup → the presentation sections fall back to the defaults if the core
    (id, Dify, allowedOrigins) is valid; otherwise the tenant is unavailable. The error is logged
    with the file, path and reason;
  - an invalid change at runtime → the tenant keeps its last valid configuration; error logged;
  - a valid change → applied without restart (next widget load uses it).

## Loader configuration

- `GET /api/loader-config?tenant=&locale=` returns what the host-page loader needs before the
  iframe exists (launcher colors, position, icon, window size, proactive message), so the
  launcher never flashes default colors.
- CORS: `Access-Control-Allow-Origin` is set only for an `Origin` in the tenant's
  `allowedOrigins` (`Vary: Origin`); no credentials. `Cache-Control: max-age=60` and an `ETag`
  (304 on `If-None-Match`). It is the only cross-site `/api/*` endpoint (exempt from the
  `Sec-Fetch-Site` check of ADR 005).

## Proactive message

- A bubble above the launcher after `delaySeconds`, without opening the window; never steals
  focus; one polite announcement (`role="status"`); close button with a label; clicking it opens
  the chat. Not shown if the visitor already opened the chat, nor on phones unless
  `showOnMobile`. Shown once per browsing session: the loader stores only a "shown" flag in the
  host page's `sessionStorage`. The animation is disabled with `prefers-reduced-motion`.

## How E4 prepares E4b (admin interface)

- E4b reads and writes **exactly this schema**; its form can be generated/validated from it.
- E4b adds a `PostgresTenantSource` (drafts, immutable published versions, audit) behind the
  same `TenantSource` interface; publishing triggers the same hot reload. The YAML files stay as
  seed and export format.
- Images uploaded through E4b go through a different path (magic bytes, re-encoding, EXIF
  removal) and **will not accept SVG**; SVG remains possible only for repository-managed assets.
- `allowedOrigins` changes will require `widget-admin` in E4b; in E4 they need a reviewed commit.
