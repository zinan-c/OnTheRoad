ALTER TABLE import_job
  ADD COLUMN IF NOT EXISTS mapping_version integer NOT NULL DEFAULT 0;

ALTER TABLE import_job
  ADD CONSTRAINT import_job_mapping_version_check CHECK (mapping_version >= 0);
