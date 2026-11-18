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
