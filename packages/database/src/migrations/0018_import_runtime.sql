ALTER TABLE attachment
  ADD COLUMN IF NOT EXISTS trip_id uuid;

ALTER TABLE import_inspect_job
  ADD COLUMN IF NOT EXISTS trip_id uuid;

CREATE INDEX IF NOT EXISTS import_inspect_job_trip_created_idx
  ON import_inspect_job (trip_id, created_at DESC, id);
