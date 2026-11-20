-- E5 B9: the detailed, hash-chained audit log (docs/plans/E5.md).
-- Every record belongs to a chain (a client's id, or `platform`), has a sequence number in it, the
-- hash of the previous record and its own hash. Records written before this migration (development
-- databases only) keep hash NULL: "before the chain".
ALTER TABLE audit_log
  ADD COLUMN chain        text,
  ADD COLUMN seq          bigint,
  ADD COLUMN actor_kind   text NOT NULL DEFAULT 'user',
  ADD COLUMN actor_email  text,
  ADD COLUMN actor_role   text,
  ADD COLUMN actor_org    text,
  ADD COLUMN actor_source text,
  ADD COLUMN ip           text,
  ADD COLUMN user_agent   text,
  ADD COLUMN session_hash text,
  ADD COLUMN request_id   text,
  ADD COLUMN section      text,
  ADD COLUMN result       text NOT NULL DEFAULT 'success',
  ADD COLUMN reason       text,
  ADD COLUMN version      integer,
  ADD COLUMN sensitive    boolean NOT NULL DEFAULT false,
  ADD COLUMN source       text NOT NULL DEFAULT 'gateway',
  ADD COLUMN external_id  text,
  ADD COLUMN prev_hash    text,
  ADD COLUMN hash         text;

UPDATE audit_log SET chain = tenant_id WHERE chain IS NULL;
ALTER TABLE audit_log ALTER COLUMN chain SET NOT NULL;
ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_result CHECK (result IN ('success', 'denied', 'failed')),
  ADD CONSTRAINT audit_log_chained CHECK ((seq IS NULL) = (hash IS NULL));

CREATE UNIQUE INDEX audit_log_chain_seq ON audit_log (chain, seq) WHERE seq IS NOT NULL;
-- Keycloak events are imported once (K1).
CREATE UNIQUE INDEX audit_log_external ON audit_log (chain, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX audit_log_chain_at ON audit_log (chain, at DESC);
CREATE INDEX audit_log_chain_action ON audit_log (chain, action);
CREATE INDEX audit_log_chain_actor ON audit_log (chain, actor_subject);

-- Where the Keycloak events import has reached, per realm (K1); state in the database so any
-- gateway replica can continue it.
CREATE TABLE audit_import_state (
  realm             text        PRIMARY KEY,
  events_after      bigint      NOT NULL DEFAULT 0,
  admin_events_after bigint     NOT NULL DEFAULT 0,
  last_success      timestamptz,
  failing_since     timestamptz,
  alerted           boolean     NOT NULL DEFAULT false
);
REVOKE ALL ON audit_import_state FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON audit_import_state TO widget_app;
