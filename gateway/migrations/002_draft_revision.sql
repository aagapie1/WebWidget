-- Optimistic concurrency for drafts (E4b.1): every save names the revision it started from; a
-- save based on an older revision is refused instead of overwriting another editor's work.
ALTER TABLE tenant_config_drafts ADD COLUMN revision integer NOT NULL DEFAULT 1;
