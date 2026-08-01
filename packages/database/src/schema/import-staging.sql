CREATE TABLE IF NOT EXISTS import_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  owner_id text NOT NULL,
  resumed_from_job_id uuid,
  source_attachment_id uuid NOT NULL,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  importer_type text NOT NULL CHECK (importer_type IN ('xlsx', 'xls', 'csv')),
  importer_version text NOT NULL CHECK (char_length(importer_version) BETWEEN 1 AND 100),
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(mapping) = 'object'),
  mapping_hash text NOT NULL CHECK (mapping_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'parsing', 'mapping_required', 'validating', 'geocoding', 'confirmation_required', 'ready_to_import', 'importing', 'processing_media', 'completed', 'completed_with_warnings', 'failed', 'cancelling', 'cancelled')),
  stage text NOT NULL DEFAULT 'uploaded',
  total_rows integer NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  valid_rows integer NOT NULL DEFAULT 0 CHECK (valid_rows >= 0),
  error_rows integer NOT NULL DEFAULT 0 CHECK (error_rows >= 0),
  imported_rows integer NOT NULL DEFAULT 0 CHECK (imported_rows >= 0),
  error_code text,
  error_message text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (trip_id, owner_id) REFERENCES trip(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (source_attachment_id, owner_id) REFERENCES attachment(id, owner_id) ON DELETE RESTRICT,
  CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]+$'),
  UNIQUE (id, trip_id),
  UNIQUE (trip_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS import_job_trip_status_idx
  ON import_job (trip_id, status, created_at DESC, id);

CREATE TABLE IF NOT EXISTS import_row (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_job_id uuid NOT NULL,
  sheet_name text NOT NULL CHECK (char_length(sheet_name) BETWEEN 1 AND 255),
  row_number integer NOT NULL CHECK (row_number > 0),
  source_row_key text NOT NULL CHECK (char_length(source_row_key) BETWEEN 1 AND 500),
  raw_data jsonb NOT NULL CHECK (jsonb_typeof(raw_data) = 'object'),
  normalized_data jsonb CHECK (normalized_data IS NULL OR jsonb_typeof(normalized_data) = 'object'),
  fingerprint text CHECK (fingerprint IS NULL OR fingerprint ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'new', 'update', 'duplicate', 'error', 'unresolved', 'ready', 'imported', 'skipped')),
  errors jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(errors) = 'array'),
  staged_location jsonb CHECK (staged_location IS NULL OR jsonb_typeof(staged_location) = 'object'),
  imported_item_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_job_id, sheet_name, row_number),
  UNIQUE (import_job_id, source_row_key)
);

CREATE INDEX IF NOT EXISTS import_row_job_status_idx
  ON import_row (import_job_id, status, row_number, id);

CREATE TABLE IF NOT EXISTS import_commit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  owner_id text NOT NULL,
  import_job_id uuid NOT NULL,
  import_row_id uuid NOT NULL,
  itinerary_item_id uuid,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  importer_version text NOT NULL,
  mapping_hash text NOT NULL CHECK (mapping_hash ~ '^[0-9a-f]{64}$'),
  source_row_key text NOT NULL,
  row_fingerprint text NOT NULL CHECK (row_fingerprint ~ '^[0-9a-f]{64}$'),
  action text NOT NULL CHECK (action IN ('insert', 'update', 'skip')),
  override_decision_id uuid,
  override_reason text,
  committed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (trip_id, owner_id) REFERENCES trip(id, owner_id) ON DELETE CASCADE,
  UNIQUE (import_job_id, import_row_id),
  UNIQUE (trip_id, source_sha256, importer_version, mapping_hash, source_row_key)
);

CREATE TABLE IF NOT EXISTS import_fingerprint_claim (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  owner_id text NOT NULL,
  row_fingerprint text NOT NULL CHECK (row_fingerprint ~ '^[0-9a-f]{64}$'),
  claim_scope text NOT NULL DEFAULT 'trip' CHECK (claim_scope IN ('trip', 'source')),
  import_job_id uuid NOT NULL,
  import_row_id uuid NOT NULL,
  itinerary_item_id uuid,
  override_decision_id uuid,
  override_reason text,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (trip_id, owner_id) REFERENCES trip(id, owner_id) ON DELETE CASCADE,
  UNIQUE (trip_id, row_fingerprint, claim_scope),
  UNIQUE (import_job_id, import_row_id)
);
