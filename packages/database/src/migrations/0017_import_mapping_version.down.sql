ALTER TABLE import_job DROP CONSTRAINT IF EXISTS import_job_mapping_version_check;
ALTER TABLE import_job DROP COLUMN IF EXISTS mapping_version;
