# E4b.1 — acceptance against the specification

Specification: [widget-E4b-admin-SPEC.md](../specs/widget-E4b-admin-SPEC.md), §9 (acceptance
criteria) and §11 (what E4b.1 delivers; E4b.2 completes it). Checked on 2026-11-19. **E4b.1 is closed.**

How it was checked: unit and API tests (Vitest, gateway against Postgres and Redis), e2e tests
(Playwright, with Keycloak 26.3 and the test realms, in Chromium, Firefox and WebKit in CI), and the
review screenshots in [admin/](admin/README.md). Test names below are those in the repository.

## §9 — acceptance criteria

- [x] **A client's `widget-admin` signs in through Keycloak and can neither see nor change another
      client, also through direct API requests, including with a token issued by another client's
      realm.**
      e2e: "a client administrator signs in to their own tenant and cannot reach another" (direct
      GET and PUT on the other tenant: 403), "a user of another client realm only reaches their
      own tenant". Gateway: "rejects a token issued by another client realm (no session)",
      "accepts only the session cookie: no cookie or a bearer token is unauthenticated", "ignores
      tenant-like claims: only the issuer decides", "isolates tenants: another tenant answers 403".
- [x] **A test realm brokered to a second Keycloak (simulating the client's IdP) maps groups to
      roles correctly.**
      e2e: "groups of the brokered identity provider map to roles" (realm `idp-sim`); "users
      without a chatbot group are refused, with an explanation".
- [x] **A `widget-editor` can save the draft but cannot publish.**
      e2e: "an editor saves the draft but cannot publish (visible reason)" (the reason on hover and
      focus; a direct POST to publish: 403). Gateway: "lets an editor save a draft that the public
      widget does not see, but not publish it".
- [x] **Changing the launcher's color, position and icon shows in the preview at once and in the
      public widget only after publishing, without restarting the gateway.**
      e2e: "changes show in the preview at once and publicly only after publishing" (color,
      position and icon in the preview; the public `loader-config` unchanged, then changed after
      publishing through the hot reload). Gateway: "hot-reloads a tenant on NOTIFY", "publishes a
      valid draft: new version, hot reload without restart, audit with the diff".
- [x] **The proactive message appears above the launcher after the configured delay, without
      opening the window.**
      e2e (public widget): "proactive message: after the delay, as a status, opens the chat, once
      per session", "proactive message can be dismissed with its labelled close button". Widget:
      "shows the proactive message after the delay, as a status, without taking focus". In the
      admin, the "Mesaj proactiv" area shows the bubble in the preview at once (e2e "the preview
      opens on a sample conversation and follows the edited section").
- [x] **A color pair below the AA contrast blocks publishing.**
      e2e: "a color pair below the AA contrast blocks publishing" (in the interface, and the API
      answers 422). Gateway: "blocks publishing a configuration below the AA contrast". The
      automatic colors (ADR 012) avoid most of these errors in the first place.
- [ ] **Reverting to an earlier version restores exactly its configuration.**
      **→ E4b.2, by design** (§11 puts version history with differences and revert in E4b.2). The
      groundwork is in E4b.1: every published version is kept, immutable (gateway: "the
      application role cannot change or delete the audit log or published versions").
- [x] **An SVG file or an image with a fake extension is refused.**
      e2e: "images: SVG and fake images are refused next to the field, real ones previewed".
      Gateway: the image tests (content sniffing, re-encoding, metadata removed).
- [x] **The Dify key appears in no request, answer or export of the admin interface.**
      e2e: "the Dify key never appears in the admin interface traffic" (every answer, pages and
      bundles included; not even the connection fields). Gateway: "returns the editable
      configuration without the Dify connection or key". Export is E4b.2.
- [x] **Every publication is in the audit log, with the user and the differences.**
      Gateway: "publishes a valid draft: new version, hot reload without restart, audit with the
      diff", "seeds YAML tenants (with images) once, as version 1, with an audit record", "lists
      leaf changes for the audit log". The audit screen is E4b.2.
- [x] **Zero serious or critical axe-core violations in the admin interface.**
      e2e: "no serious or critical axe violations in the editor" (every area and region), "… on
      the login page", the sign-in screens and the Keycloak theme pages. Accessibility is checked
      in full on Chromium and WebKit (every page, every rule). Firefox crashes inside axe-core on
      some whole sections: there they are scanned piece by piece, and a remaining crash is
      reported as an annotation, not hidden as a pass (versions and the re-check at every
      dependency update: docs/BACKLOG.md).
- [x] **Unit tests, e2e (Playwright, including OIDC sign-in on the test Keycloak) and CI pass.**
      Final CI run on commit d9e8446 (GitHub Actions, workflow CI): lint, typecheck and unit tests
      green; e2e with Keycloak 26.3 and the test realms: **57 passed, 1 skipped in each of
      Chromium, Firefox and WebKit** (the skipped one is the on-demand review spec, run separately
      in the Chromium job). The 11 Firefox tests that a crash blocked on 7af5e68 ran and passed.
      The review screenshots of this commit are the CI artifact `admin-review-screenshots`.

## §11 — what E4b.1 delivers

- [x] OIDC sign-in on the development Keycloak (compose, test realms with a user per role), roles
      checked on the server — plus the sign-in screen and Keycloak theme of P3 (ADR 013).
- [x] The editing form of §5.1, with validation and the contrast check that blocks publishing —
      reworked by the UX feedback (P1–P3): one area at a time, automatic colors, texts per
      language, domains as a list.
- [x] Live preview (§5.2), desktop and phone, following the edited section.
- [x] Draft and publication with hot reload (§5.3), without the difference view (E4b.2): draft
      revisions and conflicts, discard, publish confirmation with the changed sections.
- [x] Storage in Postgres (the Postgres `TenantSource`), seeded from the YAML files.
- [x] Image upload (§5.4).
- [x] The audit log (§5.5), without a screen (E4b.2).
- [x] Security (§6):
  - [x] admin session cookie: `HttpOnly`, `Secure` over https, `SameSite=Strict`, `Path=/admin`
        (gateway: "creates a Redis session with a strict cookie …");
  - [x] CSRF on every state-changing request (gateway: "requires the CSRF token and the gateway
        Origin on state-changing requests");
  - [x] strict CSP for `/admin` (gateway: "serves the built page with a strict CSP …");
  - [x] rate limits on the sign-in and on the admin API (gateway: "rate-limits login attempts per
        client address", "rate-limits the admin API per session (600 calls a minute)"); the
        organisation lookup shares the sign-in limit (E5 tightens it, docs/BACKLOG.md);
  - [x] the Dify keys absent from the interface and the admin API (above);
  - [ ] optional, per installation: `/admin` reachable only from given networks (Traefik IP
        list). **→ E5, by design**: it is a deployment setting (Traefik), done with the production
        compose and the Traefik labels of E5.
- [x] Accessibility and languages (§7): keyboard (e2e focus order with a visible ring at every
      stop, Escape returns focus), labels, errors linked to fields, Romanian and English
      (interface switch; Keycloak follows the admin's language).

## Not in E4b.1 (by §11 and the decisions along the way)

- E4b.2: version history with differences and revert, JSON export/import, the audit screen,
  tenant administration by the super-admin, Keycloak on the server shared with the Dify console.
- E5 (docs/BACKLOG.md): production compose with Redis persistence, rate limits of the
  organisation lookup, loader styles without `style-src 'unsafe-inline'` (ADR 010, mandatory
  before the first public client), the `/admin` IP allowlist.
