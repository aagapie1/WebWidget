# ADR 015 — Audit log: what is recorded, hash chains, anchors, retention and the GDPR basis

Date: 2026-11-20. Status: accepted (E5 B9, decisions K1–K8).

## Context

Public institutions must be able to show who changed their assistant, when, from where and with
what result, and that the record was not altered afterwards. The admin interface (ADR 008) and the
per-client Keycloak realms produce these events. The log holds personal data of the
administrators (name, e-mail, IP), so it needs a legal basis and a limited retention period.

## Decision

### What is recorded

Each record holds:

- **When:** `at` in UTC. The screen and the exports show Romanian time (`Europe/Bucharest`). The
  server clock stays on UTC and is synchronised by NTP (deployment README, threat model).
- **Who:** Keycloak user id and issuer, name, e-mail, role, organisation, and the sign-in source
  (`local`, or the institution's identity provider alias from the `identity_provider` claim).
- **From where:** the IP address (taken from `X-Forwarded-For` only behind `TRUSTED_PROXIES`, D1),
  the user-agent, a hash of the session id (never the id itself), and the request's correlation id.
- **What:** the action, the section, and the fields with their old and new values (`details.changes`).
  It also holds the published version, when there is one.
- **Result:** `success`, `denied` (with a reason) or `failed`.

Events recorded:

- **Sessions:** sign-in, sign-out, expired session, refused sign-in.
- **Configuration:** draft saved, published, discarded; image uploaded and deleted (K6: only an
  image no version and no draft uses).
- **Allowed domains changed:** marked `sensitive`, with a record of its own.
- **Denials:** access denied (another client, missing role, conflicts, invalid publishes).
- **The log itself:** viewed (once per opening) and exported.
- **Keycloak:** user and admin events (failed sign-ins, password changes, realm changes),
  imported from every realm (below).

### One hash chain per client, plus the platform chain

- Every client has its own chain (`chain` = tenant id). Super-admin actions on several clients and
  system events (anchors, purges, import recovery) go to the `platform` chain.
- `hash = SHA-256(prevHash + "\n" + canonical JSON of the record)`. The JSON has sorted keys and
  leaves out empty fields.
- Writes to a chain are serialised by an advisory lock on that chain. Configuration changes are
  recorded in the same transaction as the change: no change without its record.
- Other events (sign-in, denials, views) are recorded on a best-effort basis. A database error
  there is logged (`audit_write_failed`) and does not block the user.
- The application role (`widget_app`) may only `SELECT` and `INSERT` on `audit_log`. Only the
  cleanup role (`widget_audit_cleanup`) may `DELETE`, and it is used by the purge command alone.
- `pnpm db:audit-verify` recomputes every chain and reports changed, inserted or removed records,
  plus gaps. It exits with 1 on problems.

### Daily signed anchors (K2/K3)

- `db.ts audit-anchor` writes the last hash of every chain each day to
  `audit-anchor-YYYY-MM-DD.json`, signed with Ed25519 (`.sig`). The files sit next to the backup
  and go off-site with it (restic). The anchor itself is recorded in the platform chain.
- `audit-verify --anchors <dir> --public-key <file>` also checks each signature and that each
  anchored head is still in its chain.
- Why: a chain alone does not protect against someone with database access recomputing every
  hash. Anchors held outside the database (and the private key held outside the server) turn such
  a rewrite into a detectable mismatch.

### Keycloak events (K1)

- Every realm has user events and admin events (with representations) enabled, kept 7 days in
  Keycloak.
- A confidential client `widget-audit-reader` per realm has a service account with only
  `realm-management/view-events`. It can read events and nothing else: users and realm settings
  return 403, which was checked against Keycloak 26.3.
- The gateway polls each realm (every `AUDIT_IMPORT_INTERVAL_SECONDS`, 60 by default). Only one
  replica imports at a time (an advisory lock). Duplicates are skipped by the Keycloak event id.
  The reader's own token requests are not imported.
- Failures past 5 minutes raise `audit_import_failing` in the structured logs. On recovery,
  `audit.import.recovered` goes to the platform chain with the interval it covered.

### Access (K5, K7)

- **widget-admin:** their organisation's chain. **Editor:** none (screen and API). **super-admin:**
  every client's chain and the platform chain.
- Viewing and exporting are recorded. An export (CSV or JSON, at most 100,000 records) starts with
  a header: who generated it, when, the filters, whether it is contiguous, the position and hash it
  starts after, the last hash, and how to verify it.

### Retention and GDPR

- **Legal basis:** legitimate interest (GDPR art. 6(1)(f)): the security of the service and the
  accountability of the people who change it. The data is limited to what that needs.
  Recorded are only administrators' actions, never the content of visitors' conversations. Values
  of changed fields are configuration texts. At most they hold contact details the client already
  publishes.
- **Period:** 12 months by default, configurable per client between 6 and 60 months
  (`audit.retentionMonths`, set by the super-admin). The platform chain uses `--platform-months`.
- `db.ts audit-purge` (daily, with the cleanup role) deletes the records older than the period
  from the start of each chain. In the same transaction it appends `retention.purge` with the last
  deleted position and hash. Verification starts from that anchor, so the chain stays verifiable.
- Who reads it: the client's administrators and the platform team. Export copies are the
  client's responsibility once downloaded.
- The text for the clients' privacy notice (what is recorded, why, for how long) is part of E7.

## Consequences

- Each change costs one extra insert under a per-chain lock. That is acceptable for an admin
  interface (a few writes per minute per client).
- A lost anchor key means anchors can no longer be checked: the key is backed up with the
  platform secrets, and its public half is kept with the deployment configuration.
- Events written while the database is down are lost (best effort). Configuration changes cannot
  happen without their record.
