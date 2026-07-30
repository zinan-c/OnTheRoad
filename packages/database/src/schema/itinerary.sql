CREATE UNIQUE INDEX IF NOT EXISTS trip_day_id_trip_unique_idx
  ON trip_day (id, trip_id);

CREATE UNIQUE INDEX IF NOT EXISTS destination_id_trip_unique_idx
  ON destination (id, trip_id);

CREATE TABLE IF NOT EXISTS itinerary_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  owner_id text NOT NULL,
  trip_day_id uuid NOT NULL,
  item_type text NOT NULL DEFAULT 'activity'
    CHECK (
      item_type IN (
        'activity', 'attraction', 'dining', 'hotel', 'transport', 'other'
      )
    ),
  time_kind text NOT NULL DEFAULT 'unscheduled'
    CHECK (time_kind IN ('clock', 'range', 'period', 'unscheduled')),
  start_time time,
  end_time time,
  end_day_offset smallint NOT NULL DEFAULT 0 CHECK (end_day_offset IN (0, 1)),
  time_zone text CHECK (time_zone IS NULL OR char_length(time_zone) <= 255),
  time_period text
    CHECK (
      time_period IS NULL
      OR time_period IN (
        'early_morning', 'morning', 'noon', 'afternoon',
        'evening', 'night', 'late_night'
      )
    ),
  target text CHECK (target IS NULL OR char_length(target) <= 500),
  description text CHECK (description IS NULL OR char_length(description) <= 10000),
  duration_minutes integer
    CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 0 AND 525600),
  destination_id uuid,
  location_id uuid,
  start_location_id uuid,
  end_location_id uuid,
  transport_mode_code text REFERENCES reference_transport_mode(code),
  booking_info_ciphertext bytea,
  booking_info_key_version text,
  contact_info_ciphertext bytea,
  contact_info_key_version text,
  remark text CHECK (remark IS NULL OR char_length(remark) <= 10000),
  external_source text CHECK (
    external_source IS NULL OR char_length(external_source) <= 255
  ),
  external_id text CHECK (external_id IS NULL OR char_length(external_id) <= 500),
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT itinerary_trip_owner_fk
    FOREIGN KEY (trip_id, owner_id)
    REFERENCES trip(id, owner_id)
    ON DELETE CASCADE,
  CONSTRAINT itinerary_day_trip_fk
    FOREIGN KEY (trip_day_id, trip_id)
    REFERENCES trip_day(id, trip_id)
    ON DELETE CASCADE,
  CONSTRAINT itinerary_destination_trip_fk
    FOREIGN KEY (destination_id, trip_id)
    REFERENCES destination(id, trip_id)
    ON DELETE SET NULL (destination_id),
  CONSTRAINT itinerary_location_trip_fk
    FOREIGN KEY (location_id, trip_id)
    REFERENCES location(id, trip_id)
    ON DELETE SET NULL (location_id),
  CONSTRAINT itinerary_start_location_trip_fk
    FOREIGN KEY (start_location_id, trip_id)
    REFERENCES location(id, trip_id)
    ON DELETE SET NULL (start_location_id),
  CONSTRAINT itinerary_end_location_trip_fk
    FOREIGN KEY (end_location_id, trip_id)
    REFERENCES location(id, trip_id)
    ON DELETE SET NULL (end_location_id),
  CHECK (
    coalesce(nullif(btrim(target), ''), nullif(btrim(description), ''))
      IS NOT NULL
  ),
  CHECK (
    end_day_offset = 1
    OR end_time IS NULL
    OR start_time IS NULL
    OR end_time >= start_time
  ),
  CHECK (time_kind = 'range' OR end_day_offset = 0),
  CHECK (
    (time_kind = 'clock' AND start_time IS NOT NULL AND end_time IS NULL
      AND time_period IS NULL)
    OR (time_kind = 'range' AND start_time IS NOT NULL AND end_time IS NOT NULL
      AND time_period IS NULL)
    OR (time_kind = 'period' AND start_time IS NULL AND end_time IS NULL
      AND time_period IS NOT NULL)
    OR (time_kind = 'unscheduled' AND start_time IS NULL AND end_time IS NULL
      AND time_period IS NULL)
  ),
  CHECK (
    (booking_info_ciphertext IS NULL) = (booking_info_key_version IS NULL)
  ),
  CHECK (
    (contact_info_ciphertext IS NULL) = (contact_info_key_version IS NULL)
  ),
  CHECK ((external_source IS NULL) = (external_id IS NULL)),
  UNIQUE (id, trip_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS itinerary_day_order_uq
  ON itinerary_item (trip_day_id, sort_order)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS itinerary_trip_day_visible_idx
  ON itinerary_item (trip_id, trip_day_id, sort_order, id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS itinerary_location_idx
  ON itinerary_item (location_id)
  WHERE location_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS itinerary_external_id_uq
  ON itinerary_item (trip_id, external_source, external_id)
  WHERE external_source IS NOT NULL
    AND external_id IS NOT NULL
    AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS itinerary_item_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  itinerary_item_id uuid NOT NULL,
  trip_id uuid NOT NULL,
  owner_id text NOT NULL,
  action text NOT NULL CHECK (
    action IN (
      'itinerary.created',
      'itinerary.updated',
      'itinerary.copied',
      'itinerary.deleted'
    )
  ),
  version integer NOT NULL CHECK (version > 0),
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS itinerary_audit_owner_item_idx
  ON itinerary_item_audit (owner_id, itinerary_item_id, audit_id);
