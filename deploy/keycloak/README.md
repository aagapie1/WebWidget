# Development Keycloak realms (ADR 008)

Imported by `deploy/docker-compose.dev.yml` (`start-dev --import-realm`). Keycloak:
http://localhost:8081 (admin console: `admin` / `dev-keycloak-admin`). **Test values only**:
never use these realms or passwords outside local development and CI.

| Realm           | Purpose                                  | Users (password)                                                                                                                                                       |
| --------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pilot`         | tenant `pilot`; brokers to `idp-sim`     | `pilot-admin` (`dev-pilot-admin-Pass1`) → widget-admin, `pilot-editor` (`dev-pilot-editor-Pass1`) → widget-editor, `pilot-viewer` (`dev-pilot-viewer-Pass1`) → no role |
| `demo-primarie` | tenant `demo-primarie`                   | `demo-admin`, `demo-editor`, `demo-viewer` (`dev-demo-<role>-Pass1`)                                                                                                   |
| `platform`      | Smartbytesoft operators                  | `platform-admin` (`dev-platform-admin-Pass1`) → super-admin                                                                                                            |
| `idp-sim`       | simulates a client's IdP (e.g. Entra ID) | `alice` (group Chatbot-Administratori), `bob` (Chatbot-Editori), `carol` (Contabilitate) — `dev-idp-<name>-Pass1`                                                      |

- Roles are realm roles mapped from groups (`Chatbot-Administratori` → `widget-admin`,
  `Chatbot-Editori` → `widget-editor`), emitted in the `roles` claim of the ID token.
- `pilot` logs in through `idp-sim` (button "Contul de serviciu (IdP simulat)"): the `groups`
  claim from `idp-sim` is mapped to the same realm roles; users are created at first login.
- Admin client in each realm: `widget-admin-ui`, confidential, PKCE S256, secret
  `dev-secret-<realm>-admin-ui` (gateway env `ADMIN_OIDC_SECRET_*`).
- The files are generated once and committed; edit them directly or re-export from Keycloak.

## Verified (2026-11-18, Keycloak 26.3.5)

Authorization Code + PKCE against `widget-admin-ui` in each realm: issuers
`http://localhost:8081/realms/<realm>`; `roles` claim: `pilot-admin` → widget-admin,
`pilot-editor` → widget-editor, `pilot-viewer` → none, `demo-admin` → widget-admin,
`platform-admin` → super-admin; through `idp-sim` brokering: `alice` → widget-admin,
`bob` → widget-editor, `carol` → none (users created just-in-time in `pilot`).

Start / stop: `pnpm services:up`, `pnpm services:down` (Rancher Desktop, Podman or Docker).

## Gateways that may sign in

The `widget-admin-ui` client accepts these callbacks (development only):

- `http://localhost:3000/admin/auth/callback`: `pnpm dev` gateway;
- `http://localhost:3100/admin/auth/callback`: `pnpm --filter gateway dev:admin` (Postgres source);
- `http://localhost:3200/admin/auth/callback`: admin end-to-end tests (`E2E_ADMIN=1`, database
  `widget_e2e`).

The login page lists the organisation codes (`pilot`, `demo-primarie`, `platform`) outside
production only.

After changing a realm file, recreate the container so it imports the realms again:
`docker compose -f deploy/docker-compose.dev.yml up -d --force-recreate keycloak`.
