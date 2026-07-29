CREATE UNIQUE INDEX IF NOT EXISTS trip_id_owner_unique_idx
  ON trip (id, owner_id);

CREATE TABLE IF NOT EXISTS location (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  owner_id text NOT NULL,
  input_text text NOT NULL CHECK (char_length(input_text) BETWEEN 1 AND 2000),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 500),
  formatted_address text,
  country_code varchar(2)
    CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  city text,
  district text,
  geom geometry(Point, 4326),
  provider text NOT NULL DEFAULT 'none',
  provider_place_id text,
  source_crs text NOT NULL DEFAULT 'EPSG:4326'
    CHECK (source_crs IN ('EPSG:4326', 'GCJ02', 'BD09')),
  geocoding_status text NOT NULL DEFAULT 'unresolved'
    CHECK (
      geocoding_status IN (
        'unresolved', 'resolving', 'resolved', 'ambiguous', 'failed'
      )
    ),
  confidence numeric(5,4)
    CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  manually_adjusted boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (trip_id, owner_id)
    REFERENCES trip(id, owner_id)
    ON DELETE CASCADE,
  CHECK (
    geom IS NULL
    OR (
      ST_SRID(geom) = 4326
      AND ST_Y(geom) BETWEEN -90 AND 90
      AND ST_X(geom) BETWEEN -180 AND 180
    )
  ),
  CHECK (geocoding_status <> 'resolved' OR geom IS NOT NULL),
  CHECK (
    NOT manually_adjusted
    OR (geocoding_status = 'resolved' AND geom IS NOT NULL)
  ),
  UNIQUE (id, trip_id)
);

CREATE INDEX IF NOT EXISTS location_geom_gist_idx
  ON location USING GIST (geom);

CREATE INDEX IF NOT EXISTS location_trip_status_idx
  ON location (trip_id, geocoding_status, updated_at DESC, id);

CREATE INDEX IF NOT EXISTS location_trip_provider_place_idx
  ON location (trip_id, provider, provider_place_id)
  WHERE provider_place_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS import_location_staging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  owner_id text NOT NULL,
  source_row_key text NOT NULL,
  staged_location jsonb NOT NULL,
  status text NOT NULL DEFAULT 'staged'
    CHECK (status IN ('staged', 'ready', 'consumed', 'discarded')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (trip_id, owner_id)
    REFERENCES trip(id, owner_id)
    ON DELETE CASCADE,
  CHECK (jsonb_typeof(staged_location) = 'object'),
  CHECK (
    jsonb_typeof(staged_location->'inputText') = 'string'
    AND char_length(staged_location->>'inputText') BETWEEN 1 AND 2000
  ),
  CHECK (
    NOT (staged_location ? 'point')
    OR (
      jsonb_typeof(staged_location->'point') = 'object'
      AND (staged_location->'point'->>'crs') = 'WGS84'
      AND (staged_location->'point'->>'latitude')::numeric BETWEEN -90 AND 90
      AND (staged_location->'point'->>'longitude')::numeric BETWEEN -180 AND 180
    )
  ),
  UNIQUE (trip_id, source_row_key),
  UNIQUE (id, trip_id)
);

CREATE INDEX IF NOT EXISTS import_location_staging_trip_status_idx
  ON import_location_staging (trip_id, status, created_at, id);

CREATE TABLE IF NOT EXISTS geocoding_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  location_id uuid,
  import_staging_id uuid,
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 100),
  query text NOT NULL CHECK (char_length(query) BETWEEN 1 AND 2000),
  context jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(context) = 'object'),
  input_location_version integer,
  status text NOT NULL DEFAULT 'queued'
    CHECK (
      status IN (
        'queued', 'running', 'waiting_rate_limit', 'retry_scheduled',
        'resolved', 'ambiguous', 'failed', 'cancelled'
      )
    ),
  candidates jsonb,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 4 CHECK (max_attempts > 0),
  next_attempt_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((location_id IS NULL) <> (import_staging_id IS NULL)),
  CHECK (location_id IS NULL OR input_location_version IS NOT NULL),
  CHECK (
    candidates IS NULL
    OR (
      jsonb_typeof(candidates) = 'array'
      AND jsonb_array_length(candidates) > 0
    )
  ),
  FOREIGN KEY (location_id, trip_id)
    REFERENCES location(id, trip_id)
    ON DELETE CASCADE,
  FOREIGN KEY (import_staging_id, trip_id)
    REFERENCES import_location_staging(id, trip_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS geocoding_ready_idx
  ON geocoding_job (status, next_attempt_at, created_at, id)
  WHERE status IN ('queued', 'retry_scheduled');

CREATE INDEX IF NOT EXISTS geocoding_location_idx
  ON geocoding_job (location_id, created_at DESC)
  WHERE location_id IS NOT NULL;

CREATE OR REPLACE FUNCTION location_as_json(p_location_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'id', l.id,
    'tripId', l.trip_id,
    'ownerId', l.owner_id,
    'inputText', l.input_text,
    'name', l.name,
    'formattedAddress', l.formatted_address,
    'countryCode', l.country_code,
    'city', l.city,
    'district', l.district,
    'point', CASE
      WHEN l.geom IS NULL THEN NULL
      ELSE jsonb_build_object(
        'longitude', ST_X(l.geom),
        'latitude', ST_Y(l.geom),
        'crs', 'WGS84'
      )
    END,
    'provider', l.provider,
    'providerPlaceId', l.provider_place_id,
    'sourceCrs', l.source_crs,
    'status', l.geocoding_status,
    'confidence', l.confidence,
    'manuallyAdjusted', l.manually_adjusted,
    'version', l.version,
    'createdAt', to_char(
      l.created_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'updatedAt', to_char(
      l.updated_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    )
  )
  FROM location l
  WHERE l.id = p_location_id;
$$;

CREATE OR REPLACE FUNCTION create_location(p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  new_location_id uuid;
BEGIN
  new_location_id := COALESCE(
    NULLIF(p_input->>'id', '')::uuid,
    gen_random_uuid()
  );
  INSERT INTO location (
    id,
    trip_id,
    owner_id,
    input_text,
    name
  )
  VALUES (
    new_location_id,
    (p_input->>'tripId')::uuid,
    p_input->>'ownerId',
    p_input->>'inputText',
    p_input->>'name'
  );
  RETURN location_as_json(new_location_id);
END;
$$;

CREATE OR REPLACE FUNCTION transition_location(
  p_owner_id text,
  p_location_id uuid,
  p_expected_version integer,
  p_target_status text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  current_location location%ROWTYPE;
  is_manual boolean := COALESCE((p_payload->>'manual')::boolean, false);
  next_geom geometry(Point, 4326);
BEGIN
  SELECT * INTO current_location
  FROM location
  WHERE id = p_location_id AND owner_id = p_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LOCATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF current_location.version <> p_expected_version THEN
    RAISE EXCEPTION 'LOCATION_VERSION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;
  IF p_target_status NOT IN (
    'unresolved', 'resolving', 'resolved', 'ambiguous', 'failed'
  ) THEN
    RAISE EXCEPTION 'LOCATION_STATUS_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF NOT (
    (current_location.geocoding_status = 'unresolved'
      AND p_target_status IN ('resolving', 'resolved'))
    OR (current_location.geocoding_status = 'resolving'
      AND p_target_status IN ('resolved', 'ambiguous', 'failed'))
    OR (current_location.geocoding_status = 'ambiguous'
      AND p_target_status = 'resolved')
    OR (current_location.geocoding_status = 'failed'
      AND p_target_status = 'resolving')
    OR (current_location.geocoding_status = 'resolved'
      AND p_target_status = 'resolved' AND is_manual)
  ) THEN
    RAISE EXCEPTION 'INVALID_LOCATION_TRANSITION' USING ERRCODE = 'P0001';
  END IF;
  IF is_manual AND p_target_status <> 'resolved' THEN
    RAISE EXCEPTION 'MANUAL_LOCATION_MUST_BE_RESOLVED' USING ERRCODE = 'P0001';
  END IF;
  IF current_location.manually_adjusted AND NOT is_manual THEN
    RAISE EXCEPTION 'STALE_GEOCODING_RESULT' USING ERRCODE = 'P0001';
  END IF;

  IF p_payload ? 'point' THEN
    next_geom := ST_SetSRID(
      ST_MakePoint(
        (p_payload->'point'->>'longitude')::double precision,
        (p_payload->'point'->>'latitude')::double precision
      ),
      4326
    )::geometry(Point, 4326);
  ELSE
    next_geom := current_location.geom;
  END IF;

  IF p_target_status = 'resolved' AND next_geom IS NULL THEN
    RAISE EXCEPTION 'RESOLVED_POINT_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  UPDATE location
  SET
    name = COALESCE(NULLIF(p_payload->>'name', ''), name),
    formatted_address = CASE
      WHEN p_payload ? 'formattedAddress' THEN p_payload->>'formattedAddress'
      ELSE formatted_address
    END,
    country_code = CASE
      WHEN p_payload ? 'countryCode' THEN p_payload->>'countryCode'
      ELSE country_code
    END,
    city = CASE WHEN p_payload ? 'city' THEN p_payload->>'city' ELSE city END,
    district = CASE
      WHEN p_payload ? 'district' THEN p_payload->>'district'
      ELSE district
    END,
    geom = next_geom,
    provider = COALESCE(NULLIF(p_payload->>'provider', ''), provider),
    provider_place_id = CASE
      WHEN p_payload ? 'providerPlaceId' THEN p_payload->>'providerPlaceId'
      ELSE provider_place_id
    END,
    source_crs = COALESCE(NULLIF(p_payload->>'sourceCrs', ''), source_crs),
    geocoding_status = p_target_status,
    confidence = CASE
      WHEN p_payload ? 'confidence' THEN (p_payload->>'confidence')::numeric
      ELSE confidence
    END,
    manually_adjusted = manually_adjusted OR is_manual,
    version = version + 1,
    updated_at = clock_timestamp()
  WHERE id = p_location_id;

  RETURN location_as_json(p_location_id);
END;
$$;
