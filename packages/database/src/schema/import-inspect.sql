CREATE TABLE IF NOT EXISTS import_inspect_job (
  id uuid PRIMARY KEY,
  trip_id uuid,
  owner_id text NOT NULL CHECK (char_length(owner_id) BETWEEN 1 AND 255),
  attachment_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  inspection jsonb,
  error_code text,
  error_message text,
  retryable boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  CHECK (
    (
      status = 'queued'
      AND attempts = 0
      AND inspection IS NULL
      AND error_code IS NULL
      AND error_message IS NULL
      AND retryable IS NULL
      AND started_at IS NULL
      AND completed_at IS NULL
    )
    OR
    (
      status = 'processing'
      AND attempts > 0
      AND inspection IS NULL
      AND error_code IS NULL
      AND error_message IS NULL
      AND retryable IS NULL
      AND started_at IS NOT NULL
      AND completed_at IS NULL
    )
    OR
    (
      status = 'succeeded'
      AND attempts > 0
      AND jsonb_typeof(inspection) = 'object'
      AND inspection ? 'format'
      AND inspection ? 'sheets'
      AND jsonb_typeof(inspection->'sheets') = 'array'
      AND error_code IS NULL
      AND error_message IS NULL
      AND retryable IS NULL
      AND started_at IS NOT NULL
      AND completed_at IS NOT NULL
    )
    OR
    (
      status = 'failed'
      AND attempts > 0
      AND inspection IS NULL
      AND error_code ~ '^[A-Z][A-Z0-9_]+$'
      AND error_message IS NOT NULL
      AND retryable IS NOT NULL
      AND started_at IS NOT NULL
      AND completed_at IS NOT NULL
    )
  ),
  CONSTRAINT import_inspect_job_attachment_owner_fk
    FOREIGN KEY (attachment_id, owner_id)
    REFERENCES attachment(id, owner_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS import_inspect_job_owner_created_idx
  ON import_inspect_job (owner_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS import_inspect_job_queued_idx
  ON import_inspect_job (created_at, id)
  WHERE status = 'queued';
