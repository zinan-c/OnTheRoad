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
    OR (current_location.geocoding_status = 'failed'
      AND p_target_status = 'resolved' AND is_manual)
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
    attribution = CASE
      WHEN p_payload ? 'attribution' THEN p_payload->>'attribution'
      ELSE attribution
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
