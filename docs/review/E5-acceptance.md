# E5 — acceptance criteria (security and anti-abuse)

Plan: [docs/plans/E5.md](../plans/E5.md). Filled in at the end of E5, in the style of
[E4b1-acceptance.md](E4b1-acceptance.md): each item with the test or check that proves it.

## A. Public surface

- [x] **A site with a strict CSP and no `style-src 'unsafe-inline'` shows a styled launcher, opens
      the chat and sends a message, with no CSP violation, in Chromium, Firefox and WebKit (e2e);
      the fallback CSS file path works too. "Integrare pe site" no longer mentions
      `'unsafe-inline'`.**
      e2e [strict-csp.spec.ts](../../e2e/tests/strict-csp.spec.ts), 4 tests per browser: the
      client page's policy is built from `cspFor()` (the list "Integrare pe site" shows), as
      `default-src 'none'` + the list and, most restrictive, `default-src 'self'` + exactly the
      list; each with constructable stylesheets and with the forced `/w/loader.css` fallback. Each
      test asserts the received CSP (style-src and script-src only the gateway, no
      `'unsafe-inline'` or `'unsafe-eval'`), the whole widget with its styles (launcher with its
      image icon, proactive message, 400 px window, an answer, the tenant's bubble color in the
      iframe) and no CSP violation in the page or the iframe. Green in Chromium, Firefox and WebKit
      in CI run 44756602039 (a1c443b, 65 tests per browser). Controls: an inline `<style>` on the
      page is reported; with the previous loader all 4 tests fail. Admin: "never asks for
      'unsafe-inline' (E5 A1, ADR 010), in Romanian or English". Widget unit tests: both style
      paths. [ADR 010](../adr/010-loader-styles-csp.md).
- [ ] Every public endpoint answers as expected for an allowed origin, another origin, no origin
      and `Origin: null` (table test); `/w/app` is framed only by the client's allowed sites
      (`frame-ancestors`), and a `Referer` that contradicts `parent` is refused.
- [ ] A client cannot fake its IP through `X-Forwarded-For`: the header is believed only from the
      configured trusted proxies (the Traefik network); otherwise the connection's address is used
      (D1, fixed first; test).
- [ ] Per-IP and per-visitor limits on messages, new conversations, feedback and history are
      enforced across gateway replicas (Redis), with the default values of the plan and per-client
      settings; a message over the maximum length (2000 by default, per client) is refused.
- [ ] When a limit is reached, the widget says so in Romanian and English, politely, with the
      waiting time, keeps the question in the field, and announces it once to screen readers.
- [ ] Above the thresholds, new conversations need a proof-of-work solved in the background; no
      visual or audio CAPTCHA, nothing loaded from a third party, usable from the keyboard and
      with a screen reader; below the thresholds nothing changes.
- [ ] With sample data (fictitious CNP, phone, e-mail, IBAN, card number passing Luhn) in messages, feedback
      comments and error texts, no log line and no stored comment contains them.

## B. Administration

- [ ] The organisation lookup has its own per-IP and global limits, answers in the same time
      whether the organisation exists or not, and logs an alert on bursts of not-found answers.
- [ ] With `ADMIN_ALLOWED_IPS` set, `/admin` (preview included) answers only to those networks;
      unset, nothing changes; Keycloak is unaffected.
- [ ] Cookie flags, CSRF, session length and idle timeout are written down (ADR 014) and tested; a
      user disabled or signed out in Keycloak loses their admin sessions (back-channel logout),
      and the platform team can end a user's or a client's sessions from the command line.

### B9. Audit log (moved from E4b.2)

- [x] **Every event records the exact time (UTC in the database, Romanian time on screen and in
      exports; server clock on NTP, documented), who (Keycloak user id, name, e-mail, role,
      organisation, sign-in source: local account or the institution's IdP), from where (IP after
      D1, user-agent, a hash of the session id, the request's correlation id), what (action,
      section, fields with old and new values, published version) and the result (succeeded,
      denied with its reason, failed).**
      Gateway: "keeps every field of the event, and the application cannot change or delete it";
      "records sign-in, refused sign-in, sign-out and an expired session, with who and where";
      "believes X-Forwarded-For only from the trusted proxies (E5 D1)". Admin: "uses Romanian days
      (summer and winter time)", "shows times in Romania whatever the language". NTP: checked on the
      server on 2026-11-19, the check in [deploy/README.md](../../deploy/README.md) and the threat
      model.
- [x] **Recorded: sign-in, sign-out, expired session, refused sign-in; failed sign-ins and the other
      Keycloak user and admin events, imported from every realm; draft saved, published,
      discarded; image uploaded and deleted; allowed domains changed, marked sensitive; access
      denied (an editor publishing, a request to another client); the log viewed and exported.**
      Gateway: the sign-in test above; "records refusals: an editor publishing, a draft conflict,
      another client, the domains"; "imports user and admin events once, mapped, without the import
      account itself"; "alerts once after 5 minutes of failure, and records the recovery with the
      interval"; "deletes only an image no version or draft uses, recorded; editors cannot (E5
      K6)"; the screen API tests (opening and export recorded). Checked against the development
      Keycloak 26.3: the reader account reads events, and gets 403 on users and realm settings. e2e:
      "an unused image is deleted after confirmation, and the deletion is in the log (K6)".
- [x] **The log is append-only for the application and hash-chained: a verification command finds
      any changed, removed or inserted record (tested by tampering with a row).**
      Gateway: "keeps every field … the application cannot change or delete it" (UPDATE and DELETE
      refused for `widget_app`); "finds a changed, a removed or a rewritten record (tampering with
      database access)"; "a signed daily anchor catches a chain rewritten from scratch with
      recomputed hashes". `db:audit-verify` with `--anchors` run by hand with an `openssl` key
      pair as documented (exit 0).
- [x] **The "Jurnal de audit" screen lists events with filters (period, user, action, section,
      result) and search, shows an event's old/new diff, and exports CSV and JSON (the export is
      recorded). A widget-admin sees only their organisation, an editor has no access (screen and
      API), the super-admin sees every one. e2e tests: filters, export, isolation between clients.**
      e2e ([admin-audit.spec.ts](../../e2e/tests/admin-audit.spec.ts)): "filters: period, action,
      result and search narrow the log; the detail shows the diff" (with an axe scan of the
      screen); "export: CSV and JSON with the filters, a header and the hashes; the export is
      recorded"; "isolation: each client sees only its own log; editors none; super-admin all".
      Gateway: "lists the own organisation with filters and pages; records the opening once";
      "editors have no access; another client is refused (and recorded); super-admin sees all";
      "exports CSV and JSON with a header an auditor can check". Admin: AuditLog and Editor tests.
- [x] **Records older than the retention period (12 months by default, per client) are deleted
      automatically; the deletion is recorded as a system event and the chain stays verifiable.**
      Gateway: "deletes only what is older than the retention, records it, and the chain stays
      verifiable" (12 months by default, 24 from a client's published configuration); "never keeps
      less than 6 months, whatever a configuration says". The daily run (`audit-purge` with the
      cleanup role) is in the deployment README; scheduling it is part of the production compose
      (area C).
- [x] **An ADR states the GDPR basis (legitimate interest, security) and the period; the text for the
      clients' privacy notice is listed for E7.**
      [ADR 015](../adr/015-audit-log.md) (basis, period, who reads it); the E7 item is in
      [BACKLOG.md](../BACKLOG.md). Threat model: [audit log](../security/threat-model.md).

## C. Production and infrastructure

- [ ] `deploy/docker-compose.yml` starts the gateway stack (Keycloak and Traefik are shared server
      services in `/srv/shared`, ADR) with TLS (Let's Encrypt; port 80 open at the provider, DNS-01
      documented), HSTS and the
      80 → 443 redirect; Redis keeps its data across a restart (the chosen persistence, ADR);
      Postgres is dumped daily into the directory the server's restic plan backs up, and a restore
      from a dump has been tested and documented.
- [ ] Every container runs as non-root, read-only where possible, with `no-new-privileges`,
      `cap_drop: ALL`, memory and CPU limits and a healthcheck (checked by a script over the
      composed configuration).
- [ ] No secret is in git or in an image; secrets come only from restricted env files or Docker
      secrets (checked by the secrets script and gitleaks, in CI and before deploy).
- [ ] Every answer carries the security headers for its kind (CSP, `X-Content-Type-Options`,
      `Referrer-Policy`, `Permissions-Policy`; HSTS from Traefik), `/admin` included (test over
      every route type).
- [ ] Audit log (12 months by default), drafts, feedback, sessions and cited documents are deleted
      after their configured periods by the cleanup job, which never uses the application's
      credentials.

## D. Supply chain and verification

- [ ] CI blocks on vulnerable dependencies (`pnpm audit`, at the agreed level) and on critical
      image vulnerabilities (Trivy); an SBOM is produced at build; automatic dependency updates
      are on.
- [ ] A ZAP baseline scan runs in CI against the test environment, with every accepted finding
      explained (blocking after the agreed report-only period).
- [ ] `docs/security/threat-model.md` lists what is protected, from whom, how, and the remaining
      risks with their owners.
- [ ] Unit tests, e2e (three browsers, with Keycloak) and CI pass.
