CREATE TABLE IF NOT EXISTS accommodation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  itinerary_item_id uuid NOT NULL,
  trip_id uuid NOT NULL,
  location_id uuid,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 500),
  details text CHECK (details IS NULL OR char_length(details) <= 5000),
  check_in_at timestamptz,
  check_out_at timestamptz,
  booking_info_ciphertext bytea,
  booking_info_key_version text,
  contact_info_ciphertext bytea,
  contact_info_key_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accommodation_item_trip_fk
    FOREIGN KEY (itinerary_item_id, trip_id)
    REFERENCES itinerary_item(id, trip_id)
    ON DELETE CASCADE,
  CONSTRAINT accommodation_location_trip_fk
    FOREIGN KEY (location_id, trip_id)
    REFERENCES location(id, trip_id)
    ON DELETE SET NULL (location_id),
  CHECK (check_out_at IS NULL OR check_in_at IS NULL OR check_out_at >= check_in_at),
  CHECK (
    (booking_info_ciphertext IS NULL) = (booking_info_key_version IS NULL)
  ),
  CHECK (
    (contact_info_ciphertext IS NULL) = (contact_info_key_version IS NULL)
  ),
  UNIQUE (itinerary_item_id)
);

CREATE INDEX IF NOT EXISTS accommodation_location_idx
  ON accommodation (location_id)
  WHERE location_id IS NOT NULL;
