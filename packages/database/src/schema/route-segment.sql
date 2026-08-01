CREATE TABLE IF NOT EXISTS route_segment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  owner_id text NOT NULL,
  trip_day_id uuid NOT NULL,
  segment_kind text NOT NULL CHECK (segment_kind IN ('between_items', 'item_transport')),
  from_itinerary_item_id uuid NOT NULL,
  to_itinerary_item_id uuid NOT NULL,
  from_location_id uuid,
  to_location_id uuid,
  transport_mode_code text NOT NULL DEFAULT 'OTHER',
  departure_time timestamptz,
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  distance_meters integer CHECK (distance_meters IS NULL OR distance_meters >= 0),
  cost numeric(20, 4) CHECK (cost IS NULL OR cost >= 0),
  currency text REFERENCES reference_currency(code),
  route_geometry geometry(LineString, 4326),
  route_provider text,
  provider_route_id text,
  route_quality text NOT NULL DEFAULT 'unknown'
    CHECK (route_quality IN ('actual', 'approximate', 'manual', 'unknown')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'resolving', 'resolved', 'failed', 'manual', 'obsolete')),
  source_version text NOT NULL CHECK (source_version ~ '^[0-9a-f]{64}$'),
  source_context jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(source_context) = 'object'),
  remark text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (trip_id, owner_id) REFERENCES trip(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (trip_day_id, trip_id) REFERENCES trip_day(id, trip_id) ON DELETE CASCADE,
  FOREIGN KEY (from_itinerary_item_id, trip_id)
    REFERENCES itinerary_item(id, trip_id) ON DELETE CASCADE,
  FOREIGN KEY (to_itinerary_item_id, trip_id)
    REFERENCES itinerary_item(id, trip_id) ON DELETE CASCADE,
  FOREIGN KEY (from_location_id, trip_id)
    REFERENCES location(id, trip_id) ON DELETE SET NULL,
  FOREIGN KEY (to_location_id, trip_id)
    REFERENCES location(id, trip_id) ON DELETE SET NULL,
  CHECK (
    (segment_kind = 'item_transport' AND from_itinerary_item_id = to_itinerary_item_id)
    OR (segment_kind = 'between_items' AND from_itinerary_item_id <> to_itinerary_item_id)
  )
);

CREATE INDEX IF NOT EXISTS route_segment_day_status_idx
  ON route_segment (trip_day_id, status, updated_at DESC, id);

CREATE INDEX IF NOT EXISTS route_segment_geometry_gist_idx
  ON route_segment USING GIST (route_geometry);

CREATE UNIQUE INDEX IF NOT EXISTS route_segment_active_pair_uq
  ON route_segment (
    trip_id, trip_day_id, segment_kind,
    from_itinerary_item_id, to_itinerary_item_id
  )
  WHERE status <> 'obsolete';
