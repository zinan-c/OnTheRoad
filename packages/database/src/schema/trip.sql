CREATE TABLE IF NOT EXISTS trip (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  start_date date NOT NULL,
  end_date date NOT NULL,
  total_days integer GENERATED ALWAYS AS ((end_date - start_date) + 1) STORED,
  travelers smallint NOT NULL DEFAULT 1 CHECK (travelers BETWEEN 1 AND 999),
  default_currency text NOT NULL REFERENCES reference_currency(code),
  budget numeric(18,2) CHECK (budget IS NULL OR budget >= 0),
  timezone text NOT NULL DEFAULT 'UTC' CHECK (char_length(timezone) BETWEEN 1 AND 255),
  map_profile text NOT NULL DEFAULT 'cn_primary'
    CHECK (map_profile IN ('cn_primary', 'international_primary', 'hybrid')),
  description text CHECK (description IS NULL OR char_length(description) <= 5000),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'archived', 'deleted')),
  status_before_delete text
    CHECK (status_before_delete IS NULL OR status_before_delete IN ('draft', 'active', 'archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (end_date >= start_date),
  CHECK (
    (status = 'deleted' AND deleted_at IS NOT NULL AND status_before_delete IS NOT NULL)
    OR (status <> 'deleted' AND deleted_at IS NULL AND status_before_delete IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS trip_owner_status_activity_idx
  ON trip (owner_id, status, last_activity_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS trip_owner_currency_idx
  ON trip (owner_id, default_currency, last_activity_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS destination (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  country_code varchar(2)
    CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  city text CHECK (city IS NULL OR char_length(city) <= 160),
  region text CHECK (region IS NULL OR char_length(region) <= 160),
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, sort_order)
);

CREATE INDEX IF NOT EXISTS destination_trip_name_idx
  ON destination (trip_id, lower(name));

CREATE TABLE IF NOT EXISTS trip_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trip_id uuid NOT NULL,
  owner_id text NOT NULL,
  action text NOT NULL
    CHECK (action IN ('trip.created', 'trip.updated', 'trip.deleted', 'trip.restored')),
  version integer NOT NULL CHECK (version > 0),
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trip_audit_owner_trip_idx
  ON trip_audit (owner_id, trip_id, audit_id);

CREATE TABLE IF NOT EXISTS trip_create_request (
  owner_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 255),
  request_hash text NOT NULL,
  trip_id uuid NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, idempotency_key)
);

CREATE OR REPLACE FUNCTION trip_as_json(p_trip_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'id', t.id,
    'ownerId', t.owner_id,
    'name', t.name,
    'startDate', to_char(t.start_date, 'YYYY-MM-DD'),
    'endDate', to_char(t.end_date, 'YYYY-MM-DD'),
    'totalDays', t.total_days,
    'travelers', t.travelers,
    'defaultCurrency', t.default_currency,
    'budget', CASE WHEN t.budget IS NULL THEN NULL ELSE to_char(t.budget, 'FM9999999999999990.00') END,
    'timezone', t.timezone,
    'mapProfile', t.map_profile,
    'description', t.description,
    'status', t.status,
    'version', t.version,
    'createdAt', to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'updatedAt', to_char(t.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'lastActivityAt', to_char(t.last_activity_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'deletedAt', CASE
      WHEN t.deleted_at IS NULL THEN NULL
      ELSE to_char(t.deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    END,
    'destinations', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', d.id,
            'name', d.name,
            'countryCode', d.country_code,
            'city', d.city,
            'region', d.region,
            'sortOrder', d.sort_order,
            'createdAt', to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
            'updatedAt', to_char(d.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
          )
          ORDER BY d.sort_order
        )
        FROM destination d
        WHERE d.trip_id = t.id
      ),
      '[]'::jsonb
    )
  )
  FROM trip t
  WHERE t.id = p_trip_id;
$$;

CREATE OR REPLACE FUNCTION create_trip(
  p_owner_id text,
  p_idempotency_key text,
  p_request_hash text,
  p_input jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  existing_request trip_create_request%ROWTYPE;
  new_trip_id uuid;
BEGIN
  SELECT * INTO existing_request
  FROM trip_create_request
  WHERE owner_id = p_owner_id AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF existing_request.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN trip_as_json(existing_request.trip_id);
  END IF;

  INSERT INTO trip (
    owner_id, name, start_date, end_date, travelers, default_currency,
    budget, timezone, map_profile, description
  )
  VALUES (
    p_owner_id,
    p_input->>'name',
    (p_input->>'startDate')::date,
    (p_input->>'endDate')::date,
    (p_input->>'travelers')::smallint,
    p_input->>'defaultCurrency',
    NULLIF(p_input->>'budget', '')::numeric,
    p_input->>'timezone',
    p_input->>'mapProfile',
    NULLIF(p_input->>'description', '')
  )
  RETURNING id INTO new_trip_id;

  INSERT INTO destination (trip_id, name, country_code, city, region, sort_order)
  SELECT
    new_trip_id,
    entry.value->>'name',
    NULLIF(entry.value->>'countryCode', ''),
    NULLIF(entry.value->>'city', ''),
    NULLIF(entry.value->>'region', ''),
    entry.ordinality - 1
  FROM jsonb_array_elements(p_input->'destinations')
    WITH ORDINALITY AS entry(value, ordinality);

  INSERT INTO trip_audit (trip_id, owner_id, action, version, changes)
  VALUES (new_trip_id, p_owner_id, 'trip.created', 1, p_input);

  INSERT INTO trip_create_request (owner_id, idempotency_key, request_hash, trip_id)
  VALUES (p_owner_id, p_idempotency_key, p_request_hash, new_trip_id);

  RETURN trip_as_json(new_trip_id);
EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO existing_request
    FROM trip_create_request
    WHERE owner_id = p_owner_id AND idempotency_key = p_idempotency_key;
    IF FOUND AND existing_request.request_hash = p_request_hash THEN
      RETURN trip_as_json(existing_request.trip_id);
    END IF;
    RAISE;
END;
$$;
CREATE OR REPLACE FUNCTION update_trip(
  p_owner_id text,
  p_trip_id uuid,
  p_expected_version integer,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  current_trip trip%ROWTYPE;
  next_version integer;
BEGIN
  SELECT * INTO current_trip
  FROM trip
  WHERE id = p_trip_id AND owner_id = p_owner_id AND status <> 'deleted'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRIP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF current_trip.version <> p_expected_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  next_version := current_trip.version + 1;
  UPDATE trip
  SET
    name = CASE WHEN p_patch ? 'name' THEN p_patch->>'name' ELSE name END,
    start_date = CASE WHEN p_patch ? 'startDate' THEN (p_patch->>'startDate')::date ELSE start_date END,
    end_date = CASE WHEN p_patch ? 'endDate' THEN (p_patch->>'endDate')::date ELSE end_date END,
    travelers = CASE WHEN p_patch ? 'travelers' THEN (p_patch->>'travelers')::smallint ELSE travelers END,
    default_currency = CASE
      WHEN p_patch ? 'defaultCurrency' THEN p_patch->>'defaultCurrency'
      ELSE default_currency
    END,
    budget = CASE
      WHEN p_patch ? 'budget' THEN NULLIF(p_patch->>'budget', '')::numeric
      ELSE budget
    END,
    timezone = CASE WHEN p_patch ? 'timezone' THEN p_patch->>'timezone' ELSE timezone END,
    map_profile = CASE WHEN p_patch ? 'mapProfile' THEN p_patch->>'mapProfile' ELSE map_profile END,
    description = CASE
      WHEN p_patch ? 'description' THEN NULLIF(p_patch->>'description', '')
      ELSE description
    END,
    version = next_version,
    updated_at = clock_timestamp(),
    last_activity_at = clock_timestamp()
  WHERE id = p_trip_id;

  IF p_patch ? 'destinations' THEN
    DELETE FROM destination WHERE trip_id = p_trip_id;
    INSERT INTO destination (trip_id, name, country_code, city, region, sort_order)
    SELECT
      p_trip_id,
      entry.value->>'name',
      NULLIF(entry.value->>'countryCode', ''),
      NULLIF(entry.value->>'city', ''),
      NULLIF(entry.value->>'region', ''),
      entry.ordinality - 1
    FROM jsonb_array_elements(p_patch->'destinations')
      WITH ORDINALITY AS entry(value, ordinality);
  END IF;

  INSERT INTO trip_audit (trip_id, owner_id, action, version, changes)
  VALUES (p_trip_id, p_owner_id, 'trip.updated', next_version, p_patch);
  RETURN trip_as_json(p_trip_id);
END;
$$;

CREATE OR REPLACE FUNCTION transition_trip(
  p_owner_id text,
  p_trip_id uuid,
  p_expected_version integer,
  p_target_status text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  current_trip trip%ROWTYPE;
  next_version integer;
  action_name text;
  resolved_target_status text;
BEGIN
  IF p_target_status NOT IN ('draft', 'active', 'archived', 'deleted', 'restore') THEN
    RAISE EXCEPTION 'INVALID_TRIP_TRANSITION' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO current_trip
  FROM trip
  WHERE id = p_trip_id AND owner_id = p_owner_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRIP_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF current_trip.version <> p_expected_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;
  IF p_target_status = 'restore' THEN
    IF current_trip.status <> 'deleted' THEN
      RAISE EXCEPTION 'INVALID_TRIP_TRANSITION' USING ERRCODE = 'P0001';
    END IF;
    resolved_target_status := COALESCE(current_trip.status_before_delete, 'active');
  ELSE
    resolved_target_status := p_target_status;
  END IF;
  IF current_trip.status = resolved_target_status THEN
    RETURN trip_as_json(p_trip_id);
  END IF;

  next_version := current_trip.version + 1;
  action_name := CASE WHEN resolved_target_status = 'deleted' THEN 'trip.deleted' ELSE 'trip.restored' END;
  UPDATE trip
  SET
    status = resolved_target_status,
    status_before_delete = CASE
      WHEN resolved_target_status = 'deleted' THEN current_trip.status
      ELSE NULL
    END,
    deleted_at = CASE WHEN resolved_target_status = 'deleted' THEN clock_timestamp() ELSE NULL END,
    version = next_version,
    updated_at = clock_timestamp(),
    last_activity_at = clock_timestamp()
  WHERE id = p_trip_id;
  INSERT INTO trip_audit (trip_id, owner_id, action, version, changes)
  VALUES (
    p_trip_id, p_owner_id, action_name, next_version,
    jsonb_build_object(
      'status', resolved_target_status,
      'previousStatus', current_trip.status
    )
  );
  RETURN trip_as_json(p_trip_id);
END;
$$;
