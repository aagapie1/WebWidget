# Deployment

The production compose file, TLS, Traefik and backups come with E5 area C. This file starts with
what the audit log (E5 B9, ADR 015) needs on the server.

## Server clock (NTP)

The audit log keeps exact UTC times, and the containers use the host clock. The server stays on
UTC; Romanian time is used only on screen and in exports. Check after installing the server and
after every OS upgrade:

```sh
timedatectl
```

Expected:

```
System clock synchronized: yes
NTP service: active
Time zone: Etc/UTC (UTC, +0000)
```

Last checked on the production server: 2026-11-19, as expected. If `NTP service` is not active:
`sudo timedatectl set-ntp true` (systemd-timesyncd), or install `chrony`.

## Audit log

Run as the gateway's image (`node dist/cli/db.js …`, or `pnpm db:…` in development).

| When                 | Command                                                                    | Database role (variable)                              |
| -------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------- |
| daily, before backup | `audit-anchor --out /srv/backup/audit-anchors --private-key <key file>`    | `widget_app` (`DATABASE_URL`)                         |
| daily                | `audit-purge` (add `--dry-run` to see what would be deleted)               | `widget_audit_cleanup` (`DATABASE_AUDIT_CLEANUP_URL`) |
| weekly, and on audit | `audit-verify --anchors /srv/backup/audit-anchors --public-key <pub file>` | `widget_app` (`DATABASE_URL`)                         |

- **Anchor key:** an Ed25519 key pair, created once:
  `openssl genpkey -algorithm ed25519 -out audit-anchor.key` and
  `openssl pkey -in audit-anchor.key -pubout -out audit-anchor.pub`. Keep the private key readable
  only by the job's user and back it up with the platform secrets. Keep the public key next to
  the deployment configuration and give a copy to whoever audits.
- **Anchor files** (`audit-anchor-YYYY-MM-DD.json` + `.sig`) live next to the backup, so they go
  off-site with it (restic). They must not be stored only on the database server.
- **Retention:** 12 months by default. A client can have 6–60 months (`audit.retentionMonths`,
  set by the super-admin). The platform chain uses `--platform-months` (12 by default).
- `audit-verify` exits with 1 when it finds a problem (changed, inserted or removed record, a gap,
  or a missing or mismatching anchor). Treat it as a security incident (threat model).
- **Keycloak events:** each realm's `widget-audit-reader` secret goes in `ADMIN_AUDIT_SECRET_<REALM>`
  (see `config/server/admin-auth.yaml`). Watch the logs for `audit_import_failing`.
