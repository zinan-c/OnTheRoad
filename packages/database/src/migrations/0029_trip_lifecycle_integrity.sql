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
  IF COALESCE(p_input->>'status', 'active') NOT IN ('draft', 'active') THEN
    RAISE EXCEPTION 'INVALID_TRIP_CREATE_STATUS' USING ERRCODE = 'P0001';
  END IF;

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
    budget, timezone, map_profile, description, status
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
    NULLIF(p_input->>'description', ''),
    COALESCE(p_input->>'status', 'active')
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

  IF current_trip.status = 'deleted' AND p_target_status <> 'restore' THEN
    RAISE EXCEPTION 'INVALID_TRIP_TRANSITION' USING ERRCODE = 'P0001';
  END IF;
  IF p_target_status <> 'restore' AND resolved_target_status <> 'deleted' AND NOT (
    (current_trip.status = 'draft' AND resolved_target_status = 'active')
    OR (current_trip.status = 'active' AND resolved_target_status = 'archived')
    OR (current_trip.status = 'archived' AND resolved_target_status = 'active')
  ) THEN
    RAISE EXCEPTION 'INVALID_TRIP_TRANSITION' USING ERRCODE = 'P0001';
  END IF;

  next_version := current_trip.version + 1;
  action_name := CASE
    WHEN p_target_status = 'deleted' THEN 'trip.deleted'
    WHEN p_target_status = 'restore' THEN 'trip.restored'
    ELSE 'trip.updated'
  END;
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
