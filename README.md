# Dify chat widget — development

A white-label chat widget included with one `<script>` line, and the gateway that connects it to
the Dify Service API. Requirements and stages: [docs/SPEC.md](docs/SPEC.md); working rules:
[CLAUDE.md](CLAUDE.md); deployment: [deploy/README.md](deploy/README.md).

## Setup

```sh
pnpm install
pnpm services:up      # Postgres, Redis, Keycloak (deploy/docker-compose.dev.yml)
pnpm db:migrate
pnpm dev              # gateway + widget; demo page: http://localhost:5173/demo.html
```

Test users of the development Keycloak: [deploy/keycloak/README.md](deploy/keycloak/README.md).

## Checks

```sh
pnpm lint && pnpm typecheck
pnpm test             # Vitest; the Postgres tests run when TEST_DATABASE_URL and
                      # TEST_DATABASE_OWNER_URL point to widget_test (values: .github/workflows/ci.yml)
```

## End-to-end tests (Playwright)

| Command                                     | What runs                                                                        |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm e2e`                                  | Chromium only                                                                    |
| `pnpm e2e:all`                              | Chromium, Firefox and WebKit, **one browser after another, each in its own run** |
| `E2E_BROWSERS=chromium,webkit pnpm e2e:all` | only the browsers listed                                                         |
| `pnpm e2e:all tests/admin-audit.spec.ts`    | extra arguments go to Playwright                                                 |

- **Admin tests:** set `E2E_ADMIN=1` (needs `pnpm services:up`). They use their own gateway on
  port 3200 and the `widget_e2e` database, which is **reset and seeded at the start of every
  Playwright run**.
- **Why one run per browser:** the admin tests change shared data (they publish configurations).
  A single run with all three browsers (`E2E_ALL_BROWSERS=1 pnpm e2e`) shares one database, so a
  test that publishes in Chromium leaves its values for the same test in WebKit, and that test
  then fails for a reason that has nothing to do with the code. `pnpm e2e:all` gives each browser
  a fresh database, as CI does (one job per browser). Running with one worker does not help:
  the suite already runs with `workers: 1`.
- **Reference for WebKit:** CI's WebKit on Linux. WebKit on Windows and macOS does not move to links
  with Tab by default (as in Safari), so the keyboard focus-order test fails there. That is not a
  regression.
- **Firefox on Windows:** if Firefox does not start (`browserType.launch: spawn UNKNOWN`), Windows is
  blocking Playwright's Firefox build (Smart App Control). Leave the setting as it is; Firefox runs
  in CI.
