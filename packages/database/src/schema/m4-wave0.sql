CREATE TABLE IF NOT EXISTS geocoding_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  owner_id text NOT NULL,
  import_job_id uuid NOT NULL,
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 100),
  map_profile text NOT NULL
    CHECK (map_profile IN ('cn_primary', 'international_primary', 'hybrid')),
  generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
  status text NOT NULL DEFAULT 'queued'
    CHECK (
      status IN (
        'queued', 'running', 'waiting_rate_limit', 'cancelling',
        'completed', 'completed_with_warnings', 'failed', 'cancelled'
      )
    ),
  total_units integer NOT NULL DEFAULT 0 CHECK (total_units >= 0),
  queued_units integer NOT NULL DEFAULT 0 CHECK (queued_units >= 0),
  resolving_units integer NOT NULL DEFAULT 0 CHECK (resolving_units >= 0),
  resolved_units integer NOT NULL DEFAULT 0 CHECK (resolved_units >= 0),
  ambiguous_units integer NOT NULL DEFAULT 0 CHECK (ambiguous_units >= 0),
  failed_units integer NOT NULL DEFAULT 0 CHECK (failed_units >= 0),
  cancelled_units integer NOT NULL DEFAULT 0 CHECK (cancelled_units >= 0),
  cancel_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (trip_id, owner_id)
    REFERENCES trip(id, owner_id)
    ON DELETE CASCADE,
  FOREIGN KEY (import_job_id, trip_id)
    REFERENCES import_job(id, trip_id)
    ON DELETE CASCADE,
  UNIQUE (import_job_id, generation),
  UNIQUE (id, trip_id),
  CHECK (
    queued_units + resolving_units + resolved_units + ambiguous_units
      + failed_units + cancelled_units = total_units
  ),
  CHECK (
    status NOT IN ('completed', 'completed_with_warnings', 'failed', 'cancelled')
    OR completed_at IS NOT NULL
  ),
  CHECK (status NOT IN ('cancelling', 'cancelled') OR cancel_requested_at IS NOT NULL),
  CHECK (status <> 'cancelled' OR queued_units + resolving_units = 0)
);

CREATE INDEX IF NOT EXISTS geocoding_batch_trip_status_idx
  ON geocoding_batch (trip_id, status, created_at DESC, id);

CREATE INDEX IF NOT EXISTS geocoding_batch_active_idx
  ON geocoding_batch (status, updated_at, id)
  WHERE status IN ('queued', 'running', 'waiting_rate_limit', 'cancelling');

ALTER TABLE geocoding_job
  ADD COLUMN IF NOT EXISTS batch_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'geocoding_job_batch_fk'
  ) THEN
    ALTER TABLE geocoding_job
      ADD CONSTRAINT geocoding_job_batch_fk
      FOREIGN KEY (batch_id, trip_id)
      REFERENCES geocoding_batch(id, trip_id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS geocoding_job_batch_status_idx
  ON geocoding_job (batch_id, status, created_at, id)
  WHERE batch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS staged_location_decision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  import_staging_id uuid NOT NULL,
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 255),
  decision_type text NOT NULL
    CHECK (decision_type IN ('candidate', 'map_point', 'manual_coordinate', 'accept_text')),
  source text NOT NULL
    CHECK (source IN ('provider_candidate', 'map_click', 'manual_coordinate', 'text_only')),
  decision_version integer NOT NULL CHECK (decision_version > 0),
  candidate_token_hash text
    CHECK (candidate_token_hash IS NULL OR candidate_token_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (import_staging_id, trip_id)
    REFERENCES import_location_staging(id, trip_id)
    ON DELETE CASCADE,
  UNIQUE (import_staging_id, decision_version),
  CHECK (
    (decision_type = 'candidate'
      AND source = 'provider_candidate'
      AND candidate_token_hash IS NOT NULL)
    OR (decision_type = 'map_point'
      AND source = 'map_click'
      AND candidate_token_hash IS NULL)
    OR (decision_type = 'manual_coordinate'
      AND source = 'manual_coordinate'
      AND candidate_token_hash IS NULL)
    OR (decision_type = 'accept_text'
      AND source = 'text_only'
      AND candidate_token_hash IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS staged_location_decision_trip_created_idx
  ON staged_location_decision (trip_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS staged_location_decision_staging_version_idx
  ON staged_location_decision (import_staging_id, decision_version DESC, id);

CREATE TABLE IF NOT EXISTS export_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  owner_id text NOT NULL,
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 255),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 255),
  trip_version integer NOT NULL CHECK (trip_version > 0),
  status text NOT NULL DEFAULT 'snapshotting'
    CHECK (
      status IN (
        'snapshotting', 'queued', 'waiting_assets', 'rendering', 'validating',
        'completed', 'completed_with_warnings', 'failed', 'cancelling', 'cancelled'
      )
    ),
  stage text NOT NULL DEFAULT 'snapshot'
    CHECK (stage IN ('snapshot', 'assets', 'render', 'validate', 'complete')),
  options jsonb NOT NULL CHECK (jsonb_typeof(options) = 'object'),
  options_hash text NOT NULL CHECK (options_hash ~ '^[0-9a-f]{64}$'),
  template_version text NOT NULL CHECK (char_length(template_version) BETWEEN 1 AND 100),
  template_hash text NOT NULL CHECK (template_hash ~ '^[0-9a-f]{64}$'),
  snapshot_schema_version integer CHECK (snapshot_schema_version IS NULL OR snapshot_schema_version > 0),
  snapshot jsonb CHECK (snapshot IS NULL OR jsonb_typeof(snapshot) = 'object'),
  snapshot_hash text CHECK (snapshot_hash IS NULL OR snapshot_hash ~ '^[0-9a-f]{64}$'),
  omission_count integer NOT NULL DEFAULT 0 CHECK (omission_count >= 0),
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnings) = 'array'),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]+$'),
  error_message text,
  cancel_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (trip_id, owner_id)
    REFERENCES trip(id, owner_id)
    ON DELETE CASCADE,
  UNIQUE (trip_id, idempotency_key),
  CHECK (status = 'snapshotting' OR snapshot IS NOT NULL),
  CHECK (status = 'snapshotting' OR snapshot_hash IS NOT NULL),
  CHECK (status = 'snapshotting' OR snapshot_schema_version IS NOT NULL),
  CHECK (
    status NOT IN ('completed', 'completed_with_warnings', 'failed', 'cancelled')
    OR completed_at IS NOT NULL
  ),
  CHECK (status NOT IN ('cancelling', 'cancelled') OR cancel_requested_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS export_job_trip_status_idx
  ON export_job (trip_id, status, created_at DESC, id);

CREATE INDEX IF NOT EXISTS export_job_active_idx
  ON export_job (status, updated_at, id)
  WHERE status IN ('snapshotting', 'queued', 'waiting_assets', 'rendering', 'validating', 'cancelling');

CREATE INDEX IF NOT EXISTS export_job_reuse_idx
  ON export_job (trip_id, snapshot_hash, template_version, options_hash, created_at DESC)
  WHERE status = 'completed';

CREATE TABLE IF NOT EXISTS export_job_asset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  export_job_id uuid NOT NULL,
  asset_id text NOT NULL CHECK (char_length(asset_id) BETWEEN 1 AND 500),
  kind text NOT NULL CHECK (kind IN ('image', 'map', 'font')),
  content_type text NOT NULL CHECK (char_length(content_type) BETWEEN 1 AND 255),
  checksum_sha256 text CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$'),
  object_version text,
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  required boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('ready', 'processing', 'missing', 'failed', 'excluded')),
  omission_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (export_job_id) REFERENCES export_job(id) ON DELETE CASCADE,
  UNIQUE (export_job_id, asset_id),
  CHECK (status <> 'ready' OR checksum_sha256 IS NOT NULL),
  CHECK (status NOT IN ('missing', 'failed', 'excluded') OR omission_reason IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS export_job_asset_status_idx
  ON export_job_asset (export_job_id, status, required, asset_id);
