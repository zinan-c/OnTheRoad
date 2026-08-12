-- M4 Wave1: import commit/media durability and PDF worker fencing.
-- This migration is additive. Existing Wave0 rows keep their current state.

ALTER TABLE import_job
  ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_requested_by text,
  ADD COLUMN IF NOT EXISTS committed_rows integer NOT NULL DEFAULT 0
    CHECK (committed_rows >= 0);

ALTER TABLE import_row
  ADD COLUMN IF NOT EXISTS decision_scope text NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS override_decision_id uuid,
  ADD COLUMN IF NOT EXISTS override_reason text;

ALTER TABLE import_row
  DROP CONSTRAINT IF EXISTS import_row_decision_scope_check;

ALTER TABLE import_row
  ADD CONSTRAINT import_row_decision_scope_check CHECK (
    decision_scope = 'default' OR decision_scope LIKE 'override:%'
  );

CREATE TABLE IF NOT EXISTS import_override_decision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  owner_id text NOT NULL,
  import_job_id uuid NOT NULL,
  import_row_id uuid NOT NULL,
  decision_type text NOT NULL CHECK (decision_type IN ('duplicate_insert')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
  actor_id text NOT NULL CHECK (char_length(btrim(actor_id)) BETWEEN 1 AND 255),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (trip_id, owner_id) REFERENCES trip(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (import_job_id, trip_id) REFERENCES import_job(id, trip_id) ON DELETE CASCADE,
  FOREIGN KEY (import_row_id) REFERENCES import_row(id) ON DELETE CASCADE,
  UNIQUE (import_job_id, import_row_id),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

-- The M3 ledger had a source-row unique constraint without a decision scope.
-- Remove all non-primary unique constraints by catalog identity so this remains
-- safe even when PostgreSQL truncated the generated constraint name.
DO $$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'import_commit_ledger'::regclass
      AND contype = 'u'
  LOOP
    EXECUTE format(
      'ALTER TABLE import_commit_ledger DROP CONSTRAINT IF EXISTS %I',
      constraint_row.conname
    );
  END LOOP;
END;
$$;

ALTER TABLE import_commit_ledger
  ADD COLUMN IF NOT EXISTS decision_scope text NOT NULL DEFAULT 'default';

ALTER TABLE import_commit_ledger
  DROP CONSTRAINT IF EXISTS import_commit_ledger_decision_scope_check;

ALTER TABLE import_commit_ledger
  ADD CONSTRAINT import_commit_ledger_decision_scope_check CHECK (
    (
      decision_scope = 'default'
      AND override_decision_id IS NULL
      AND override_reason IS NULL
    )
    OR
    (
      decision_scope LIKE 'override:%'
      AND override_decision_id IS NOT NULL
      AND override_reason IS NOT NULL
    )
  ),
  ADD CONSTRAINT import_commit_ledger_replay_uq UNIQUE (
    trip_id, source_sha256, importer_version, mapping_hash,
    source_row_key, decision_scope
  ),
  ADD CONSTRAINT import_commit_ledger_job_row_scope_uq UNIQUE (
    import_job_id, import_row_id, decision_scope
  );

ALTER TABLE import_fingerprint_claim
  DROP CONSTRAINT IF EXISTS import_fingerprint_claim_claim_scope_check;

DO $$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'import_fingerprint_claim'::regclass
      AND contype = 'u'
      AND conname <> 'import_fingerprint_claim_pkey'
  LOOP
    EXECUTE format(
      'ALTER TABLE import_fingerprint_claim DROP CONSTRAINT IF EXISTS %I',
      constraint_row.conname
    );
  END LOOP;
END;
$$;

ALTER TABLE import_fingerprint_claim
  ADD CONSTRAINT import_fingerprint_claim_claim_scope_check CHECK (
    claim_scope IN ('trip', 'source') OR claim_scope LIKE 'override:%'
  ),
  ADD CONSTRAINT import_fingerprint_claim_fingerprint_scope_uq UNIQUE (
    trip_id, row_fingerprint, claim_scope
  ),
  ADD CONSTRAINT import_fingerprint_claim_job_row_scope_uq UNIQUE (
    import_job_id, import_row_id, claim_scope
  ),
  ADD CONSTRAINT import_fingerprint_claim_override_uq UNIQUE (override_decision_id);

CREATE TABLE IF NOT EXISTS import_media_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  owner_id text NOT NULL,
  import_job_id uuid NOT NULL,
  import_row_id uuid NOT NULL,
  source_row_key text NOT NULL CHECK (char_length(btrim(source_row_key)) BETWEEN 1 AND 500),
  itinerary_item_id uuid,
  attachment_id uuid,
  url_ordinal integer NOT NULL CHECK (url_ordinal >= 0),
  source_url_sha256 text NOT NULL CHECK (source_url_sha256 ~ '^[0-9a-f]{64}$'),
  source_url_ciphertext bytea,
  source_url_key_version text,
  source_url_expires_at timestamptz,
  status text NOT NULL DEFAULT 'awaiting_approval'
    CHECK (status IN (
      'awaiting_approval', 'approved', 'rejected', 'queued', 'fetching',
      'quarantined', 'scanning', 'processing', 'retry_scheduled', 'ready',
      'failed', 'cancelling', 'cancelled'
    )),
  decision_by text,
  decided_at timestamptz,
  cancelled_by text,
  cancelled_actor text,
  cancelled_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lifetime_attempt_count integer NOT NULL DEFAULT 0 CHECK (lifetime_attempt_count >= 0),
  retry_generation integer NOT NULL DEFAULT 0 CHECK (retry_generation >= 0),
  max_attempts integer NOT NULL DEFAULT 4 CHECK (max_attempts > 0),
  next_attempt_at timestamptz,
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  error_code text,
  error_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (trip_id, owner_id) REFERENCES trip(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (import_job_id, trip_id) REFERENCES import_job(id, trip_id) ON DELETE CASCADE,
  UNIQUE (import_job_id, source_row_key, url_ordinal),
  CHECK (
    status IN ('awaiting_approval', 'rejected', 'cancelled')
    OR (decision_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CHECK (
    source_url_ciphertext IS NOT NULL
    AND source_url_key_version IS NOT NULL
  ),
  CHECK (
    status IN ('awaiting_approval', 'approved', 'rejected', 'queued', 'cancelled')
    OR itinerary_item_id IS NOT NULL
  ),
  CHECK (
    status <> 'ready' OR attachment_id IS NOT NULL
  ),
  CHECK (
    (
      status IN ('fetching', 'quarantined', 'scanning', 'processing')
      AND lease_owner IS NOT NULL
      AND lease_token IS NOT NULL
      AND lease_expires_at IS NOT NULL
    )
    OR (
      status NOT IN ('fetching', 'quarantined', 'scanning', 'processing')
      AND lease_owner IS NULL
      AND lease_token IS NULL
      AND lease_expires_at IS NULL
    )
  )
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'import_media_task_attachment_fk'
      AND conrelid = 'import_media_task'::regclass
  ) THEN
    ALTER TABLE import_media_task
      ADD CONSTRAINT import_media_task_attachment_fk
      FOREIGN KEY (attachment_id) REFERENCES attachment(id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS import_media_task_attachment_uq
  ON import_media_task (attachment_id)
  WHERE attachment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS import_media_task_job_status_idx
  ON import_media_task (import_job_id, status, next_attempt_at, id);

CREATE INDEX IF NOT EXISTS import_media_task_lease_idx
  ON import_media_task (status, lease_expires_at, updated_at, id)
  WHERE status IN ('fetching', 'quarantined', 'scanning', 'processing');

ALTER TABLE export_job
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS artifact_key text,
  ADD COLUMN IF NOT EXISTS artifact_version text,
  ADD COLUMN IF NOT EXISTS artifact_checksum_sha256 text,
  ADD COLUMN IF NOT EXISTS page_count integer,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

ALTER TABLE export_job
  DROP CONSTRAINT IF EXISTS export_job_version_check,
  DROP CONSTRAINT IF EXISTS export_job_lease_check;

ALTER TABLE export_job
  ADD CONSTRAINT export_job_version_check CHECK (version > 0),
  ADD CONSTRAINT export_job_lease_check CHECK (
    (worker_id IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
    OR
    (worker_id IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS export_job_lease_idx
  ON export_job (status, lease_expires_at, updated_at, id)
  WHERE status IN ('waiting_assets', 'rendering', 'validating');

ALTER TABLE attachment
  ADD COLUMN IF NOT EXISTS import_media_task_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'attachment_import_media_task_fk'
      AND conrelid = 'attachment'::regclass
  ) THEN
    ALTER TABLE attachment
      ADD CONSTRAINT attachment_import_media_task_fk
      FOREIGN KEY (import_media_task_id)
      REFERENCES import_media_task(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS attachment_import_media_task_idx
  ON attachment (import_media_task_id)
  WHERE import_media_task_id IS NOT NULL;
