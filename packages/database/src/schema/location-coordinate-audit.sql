CREATE TABLE IF NOT EXISTS location_coordinate_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_id uuid NOT NULL,
  trip_id uuid NOT NULL,
  owner_id text NOT NULL,
  action text NOT NULL CHECK (
    action IN (
      'location.coordinates.map-picked',
      'location.coordinates.marker-dragged',
      'location.coordinates.manually-entered'
    )
  ),
  from_version integer NOT NULL CHECK (from_version > 0),
  to_version integer NOT NULL CHECK (to_version = from_version + 1),
  point geometry(Point, 4326) NOT NULL,
  input_mode text NOT NULL
    CHECK (input_mode IN ('mouse', 'touch', 'keyboard', 'manual')),
  reverse_status text NOT NULL
    CHECK (reverse_status IN ('resolved', 'failed', 'not-requested')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (location_id, trip_id)
    REFERENCES location(id, trip_id)
    ON DELETE CASCADE,
  FOREIGN KEY (trip_id, owner_id)
    REFERENCES trip(id, owner_id)
    ON DELETE CASCADE,
  CHECK (
    ST_SRID(point) = 4326
    AND ST_Y(point) BETWEEN -90 AND 90
    AND ST_X(point) BETWEEN -180 AND 180
  )
);

CREATE INDEX IF NOT EXISTS location_coordinate_audit_owner_location_idx
  ON location_coordinate_audit (owner_id, location_id, audit_id);

CREATE OR REPLACE FUNCTION adjust_location_coordinates(
  p_owner_id text,
  p_location_id uuid,
  p_expected_version integer,
  p_payload jsonb,
  p_audit jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  adjusted jsonb;
  owning_trip_id uuid;
BEGIN
  adjusted := transition_location(
    p_owner_id,
    p_location_id,
    p_expected_version,
    'resolved',
    p_payload || '{"manual":true}'::jsonb
  );

  SELECT trip_id INTO owning_trip_id
  FROM location
  WHERE id = p_location_id AND owner_id = p_owner_id;

  INSERT INTO location_coordinate_audit (
    location_id,
    trip_id,
    owner_id,
    action,
    from_version,
    to_version,
    point,
    input_mode,
    reverse_status
  )
  VALUES (
    p_location_id,
    owning_trip_id,
    p_owner_id,
    p_audit->>'action',
    p_expected_version,
    (adjusted->>'version')::integer,
    ST_SetSRID(
      ST_MakePoint(
        (p_payload->'point'->>'longitude')::double precision,
        (p_payload->'point'->>'latitude')::double precision
      ),
      4326
    )::geometry(Point, 4326),
    p_audit->>'inputMode',
    p_audit->>'reverseStatus'
  );

  RETURN adjusted;
END;
$$;
