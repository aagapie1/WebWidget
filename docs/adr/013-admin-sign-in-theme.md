# ADR 013 — Admin sign-in: one Keycloak theme, the client's logo from a realm attribute

Date: 2026-11-19. Status: accepted (E4b.1 UX 16 and 17).

## Context

Administrators sign in on Keycloak's pages, one realm per client (ADR 008). They should look like
the admin interface, in Romanian by default, with the client's name and logo, without maintaining
one theme per client.

## Decision

- **One login theme, `widget-admin`** (`deploy/keycloak-themes/`), derived from `keycloak.v2`, used
  by every client realm and the platform realm (`loginTheme`). The simulated institution IdP keeps
  Keycloak's default look: it stands for the client's own identity provider.
- **Name:** the realm's `displayName`. **Logo:** the realm attribute `clientLogoUrl`, pointing to
  the gateway's stable `/w/t/<tenant>/logo` (a short-lived redirect to the content-hashed file).
  Checked on Keycloak 26.3 before building: login templates read `realm.attributes`. So
  `displayNameHtml` (which accepts HTML) is not used.
- **CSP:** each realm's Content-Security-Policy (Realm settings → Security defenses) adds
  `img-src 'self' data: <gateway origins>`, and nothing else. The e2e test checks that the logo
  really loads.
- **Language:** Keycloak lets the browser's language win over the realm default, so the admin
  passes its own interface language to the gateway (`/admin/auth/login?…&locale=ro`), which sends
  it as `ui_locales`. Keycloak's Romanian file covers 36 of 471 login strings and writes "ă" as
  "ǎ" (U+01CE); the theme ships `messages_ro.properties` for every page the admin uses.
- **No external resources:** Inter (OFL) is served by Keycloak from the theme.
- **Organisation on the admin's sign-in page:** `?org=` or the host (`ADMIN_ORG_HOSTS`), resolved one
  at a time by `GET /admin/auth/org` (rate-limited, never the list); the code field is the
  fallback ("Altă organizație?"). No automatic redirect.

## Consequences

- A new client realm needs `loginTheme: widget-admin`, `clientLogoUrl` and the CSP line; the
  realm template in `deploy/keycloak/` shows the three settings.
- The theme is mounted in the dev compose and in CI; the e2e test fails if Keycloak falls back to
  its default theme (it checks that `widget-admin.css` is loaded).
