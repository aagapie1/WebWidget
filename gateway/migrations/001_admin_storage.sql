-- Admin interface storage (E4b.1, ADR 008). Runs as the schema owner (widget_owner).
-- The gateway connects as widget_app, with the minimum privileges granted below.

-- Published configurations: one row per version, immutable.
CREATE TABLE tenant_config_versions (
  tenant_id  text        NOT NULL,
  version    integer     NOT NULL CHECK (version > 0),
  -- Tenant configuration exactly as in the YAML files (schema version 1, `${VAR}` placeholders kept).
  config     jsonb       NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text        NOT NULL,
  comment    text,
  PRIMARY KEY (tenant_id, version)
);

-- One draft per tenant; it may be invalid until published.
CREATE TABLE tenant_config_drafts (
  tenant_id    text        PRIMARY KEY,
  config       jsonb       NOT NULL,
  base_version integer,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text        NOT NULL
);

-- Tenant images (seeded from config/tenants/<id>/assets, or uploaded and re-encoded).
CREATE TABLE tenant_assets (
  tenant_id    text        NOT NULL,
  name         text        NOT NULL,
  hash         text        NOT NULL,
  content_type text        NOT NULL,
  bytes        bytea       NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text        NOT NULL,
  PRIMARY KEY (tenant_id, name)
);

-- Audit log: append-only for the application (no UPDATE/DELETE grant).
CREATE TABLE audit_log (
  id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  tenant_id     text        NOT NULL,
  actor_issuer  text        NOT NULL,
  actor_subject text        NOT NULL,
  actor_name    text,
  action        text        NOT NULL,
  details       jsonb       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_log_tenant_at ON audit_log (tenant_id, at DESC);

REVOKE ALL ON tenant_config_versions, tenant_config_drafts, tenant_assets, audit_log FROM PUBLIC;
GRANT SELECT, INSERT                 ON tenant_config_versions TO widget_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_config_drafts   TO widget_app;
GRANT SELECT, INSERT, UPDATE         ON tenant_assets          TO widget_app;
GRANT SELECT, INSERT                 ON audit_log              TO widget_app;
