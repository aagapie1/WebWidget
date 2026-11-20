-- E5 K6: an administrator may delete an uploaded image that no published version and no draft
-- uses (checked in the gateway, recorded in the audit chain in the same transaction).
GRANT DELETE ON tenant_assets TO widget_app;
