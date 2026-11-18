# ADR 008 — Admin interface, tranche E4b.1

Status: accepted (E4b.1) · 2026-11-18 · spec: `docs/specs/widget-E4b-admin-SPEC.md` v0.3

## Scope

E4b.1 (spec §11): OIDC login on a development Keycloak with server-side roles, the editing form
(§5.1) with validation and the contrast check that blocks publishing, live preview (desktop /
mobile), draft + publish with hot reload, Postgres storage with a YAML seed, image upload, audit
records (no audit screen), the security of §6. Everything else of E4b is E4b.2 (backlog).

## Components

- `admin/`: a separate workspace package (Preact + Vite), its own bundle, served by the gateway
  under `/admin/*`. The public widget bundle and budget are unaffected.
- `/admin/api/*` in the gateway (`gateway/src/admin/`), with its own cookie, CSP and rate limits.
- Keycloak, Postgres and Redis run locally from `deploy/docker-compose.dev.yml` (plain Compose
  spec: works with Rancher Desktop / dockerd, Podman and Docker; no Docker-Desktop-only features).

## Authentication: one realm per tenant (spec §4)

- OIDC Authorization Code + PKCE, performed by the gateway (backend for frontend): the browser
  never sees Keycloak tokens. Keycloak acts as identity broker towards the client's own IdP.
- **One realm per tenant** (`pilot`, `demo-primarie`) and a separate **`platform`** realm for
  `super-admin` (Smartbytesoft).
- **The tenant comes from the token issuer (`iss`)** through a fixed `issuer → tenant` map in the
  **server configuration** (`config/server/admin-auth.yaml` + secrets in env), never from the
  editable tenant configuration, a parameter or the URL. A token or session from another
  realm's issuer is rejected for this tenant (tested).
- Realm roles `widget-admin` / `widget-editor`, mapped from the client's groups
  (`Chatbot-Administratori`, `Chatbot-Editori`); roles are emitted in a `roles` claim of the ID
  token. `super-admin` exists only in `platform` and grants access to every tenant.
- Roles are checked on the server on every request. Session lifetime: 8 hours by default
  (`ssoSessionMaxLifespan` per realm, and the gateway session TTL), so removing someone from a
  group takes effect at their next login.
- Test realm `idp-sim` simulates a client IdP. `pilot` brokers to it via **Identity Brokering
  (OIDC)**; IdP mappers turn the `groups` claim from `idp-sim` into the `pilot` realm roles
  (acceptance criterion §9 on group mapping). Users are created just-in-time at first login.
- Only development realms and test credentials are in the repository (`deploy/keycloak/`); they
  are never used outside local development and CI.

## Sessions, CSRF, rate limits (spec §6)

- Admin session in **Redis** (rule 9: stateless gateway), referenced by a cookie
  `__Secure-admin` (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/admin`). Logout deletes it
  server-side.
- CSRF: a per-session token sent in `X-CSRF-Token` on every state-changing request, plus an
  `Origin` check.
- CSP for `/admin`: `default-src 'self'; frame-ancestors 'none'`; `frame-src 'self'` only for the
  preview page, which itself allows `frame-ancestors 'self'`.
- Rate limits (Redis) on the login endpoints and the admin API.
- Implementation notes (step 2):
  - Login is started per organisation: `GET /admin/auth/login?org=<tenant|platform>`. The callback
    accepts only an ID token whose `iss` maps to that same organisation (`wrong_realm` otherwise).
  - Login state (PKCE verifier, nonce, return path) lives in Redis for 10 minutes and is single
    use. It is bound to the browser by a `__Secure-admin-login` cookie (`SameSite=Lax`, because
    the IdP returns with a top-level redirect; `Path=/admin/auth`).
  - Redis keys hold a SHA-256 of the session cookie, so a Redis dump yields no usable cookie.
  - Only the session cookie authenticates. An `Authorization` header is ignored, so a bearer
    token from any realm gets `401`.
  - Logout is a CSRF-protected `POST` that returns the Keycloak end-session URL (with
    `id_token_hint`) for the interface to navigate to.
  - Plain-HTTP issuers are allowed only outside production (local Keycloak).
  - Failed logins redirect to `/admin/?error=<code>`. Logs carry only the reason, the
    organisation and the role, never names.
- Dify keys never appear in the admin API, UI or export.

## Storage: Postgres as a second `TenantSource`

- `TENANT_SOURCE=file|postgres` (server configuration). YAML stays available as a source and is
  the seed and export format (`pnpm db:seed` imports the YAML files and their assets as
  version 1).
- Tables: published versions (immutable), drafts, images, audit log. SQL migrations with a small
  runner, driver `pg`, no ORM.
- Two database roles: the migration owner, and the application role used by the gateway. The
  application role has **no UPDATE/DELETE on the audit table** (append-only enforced by Postgres,
  not only by the code). Retention (12 months by default) is applied by a separate maintenance
  job running as the owner.
- Publishing inserts a new version and sends `NOTIFY tenant_config, '<tenant>'`; every gateway
  replica `LISTEN`s and reloads that tenant (hot reload across replicas, E4 mechanism).

## Drafts, publishing, preview

- Drafts are autosaved and may be invalid; publishing requires a fully valid configuration
  (schema + contrast) and `widget-admin` (or `super-admin`).
- Preview: `/admin/preview` renders the real widget with the draft through a short-lived preview
  token (10 minutes) bound to the admin session and tenant. Requests carrying it use the draft
  instead of the published configuration.
- **Preview traffic to Dify is marked and excluded from statistics**: the Dify `user` gets the
  `preview-` prefix and the gateway logs carry `preview: true`; statistics and exports filter
  them out.

- Implementation notes (step 3):
  - The admin API never sends or accepts the server fields (`schemaVersion`, `id`, `enabled`,
    `difyBaseUrl`, `difyApiKeyEnv`). They are copied from the published version on every save,
    and managed by the platform in E4b.2 (§5.6).
  - Validation messages name paths only. A missing Dify key variable is reported without its
    name.
  - Publishing takes a transaction-level advisory lock per tenant, inserts `latest + 1`, deletes
    the draft, writes the audit rows and runs `pg_notify` in the same transaction. Every replica,
    including the publishing one, reloads through LISTEN.
  - The admin interface requires `TENANT_SOURCE=postgres`; the gateway refuses to start
    otherwise.

## Images

- PNG, WebP, JPEG only (no SVG through the admin interface). Real type checked from the magic
  bytes. Size limit configurable (512 KB by default).
- Every image is **re-encoded with `sharp`** (prebuilt binaries; `limitInputPixels` set against
  decompression bombs): this drops EXIF and any other embedded metadata or trailing content, and
  bounds the dimensions. Stored in Postgres, served from `/w/t/<tenant>/<hash>-<name>` with an
  immutable cache like E4 assets.
- Stored names are content-addressed (`<base>-<sha256[:12]>.<real extension>`), so an upload
  never changes an image the public widget already uses. Uploads go through the raw request
  body (no multipart parser). The admin interface shows thumbnails from
  `/admin/api/tenants/:id/assets/:name`, because draft images are not public before publishing.
  Deleting images is left to E4b.2 (the application role has no DELETE on `tenant_assets`).

## Audit

- Draft saves, publishing, image uploads and `allowedOrigins` changes are recorded: user (issuer
  - subject + name), tenant, action, time, differences. Append-only (see roles above). No screen
    in E4b.1.
