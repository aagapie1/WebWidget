-- Development database for the admin interface (ADR 008). Test passwords only.
-- widget_owner: owns the schema and runs the migrations.
-- widget_app:   used by the gateway; the migrations grant it no UPDATE/DELETE on the audit log.
CREATE ROLE widget_owner LOGIN PASSWORD 'dev-widget-owner';
CREATE ROLE widget_app LOGIN PASSWORD 'dev-widget-app';
CREATE DATABASE widget OWNER widget_owner;
\connect widget
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO widget_owner;
GRANT USAGE ON SCHEMA public TO widget_app;

-- Separate database for the integration tests: they truncate tables (never the dev data).
\connect postgres
CREATE DATABASE widget_test OWNER widget_owner;
\connect widget_test
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO widget_owner;
GRANT USAGE ON SCHEMA public TO widget_app;

-- Separate database for the admin end-to-end tests (Playwright resets it on every run).
\connect postgres
CREATE DATABASE widget_e2e OWNER widget_owner;
\connect widget_e2e
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO widget_owner;
GRANT USAGE ON SCHEMA public TO widget_app;
