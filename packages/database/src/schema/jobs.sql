-- A06 / migration 0001. PostgreSQL remains authoritative; Redis contains
-- disposable delivery state only.
CREATE TABLE job_outbox (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  handled_at timestamptz,
  publish_attempts integer NOT NULL DEFAULT 0 CHECK (publish_attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  last_error_code text,
  UNIQUE (aggregate_type, aggregate_id, aggregate_version)
);

CREATE INDEX job_outbox_reconcile_idx
  ON job_outbox (next_attempt_at, created_at, event_id)
  WHERE handled_at IS NULL;

CREATE TABLE job_inbox (
  consumer_name text NOT NULL,
  event_id text NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_name, event_id)
);

CREATE TYPE job_run_status AS ENUM (
  'pending',
  'running',
  'retry_wait',
  'succeeded',
  'failed',
  'cancelled'
);

CREATE TABLE job_run (
  job_id text PRIMARY KEY,
  event_id text REFERENCES job_outbox(event_id),
  job_type text NOT NULL,
  status job_run_status NOT NULL DEFAULT 'pending',
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX job_run_maintenance_idx
  ON job_run (status, available_at, job_id)
  WHERE status IN ('pending', 'running', 'retry_wait');

CREATE TABLE http_idempotency (
  owner_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  response_status integer,
  response_body jsonb,
  state text NOT NULL CHECK (state IN ('running', 'completed')),
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, idempotency_key),
  CHECK (
    (state = 'running' AND response_status IS NULL AND response_body IS NULL)
    OR (state = 'completed' AND response_status IS NOT NULL)
  )
);

CREATE INDEX http_idempotency_expiry_idx ON http_idempotency (expires_at);
