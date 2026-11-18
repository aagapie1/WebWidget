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
