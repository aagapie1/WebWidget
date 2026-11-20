-- E5 B9: the audit log's retention job runs with its own role (never the application's): it may
-- read, delete the oldest records and write the retention.purge event that anchors the chain.
-- The role is created outside the migrations (deploy/postgres/init, or by the operator).
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'widget_audit_cleanup') THEN
    GRANT SELECT, INSERT, DELETE ON audit_log TO widget_audit_cleanup;
    -- Each client's retention period comes from its published configuration.
    GRANT SELECT ON tenant_config_versions TO widget_audit_cleanup;
  ELSE
    RAISE NOTICE 'role widget_audit_cleanup does not exist: the audit retention job cannot run';
  END IF;
END
$$;
