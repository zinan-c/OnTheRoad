CREATE TABLE IF NOT EXISTS dining_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  itinerary_item_id uuid NOT NULL,
  trip_id uuid NOT NULL,
  meal_type text CHECK (
    meal_type IS NULL
    OR meal_type IN ('breakfast', 'lunch', 'dinner', 'snack', 'other')
  ),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 500),
  details text CHECK (details IS NULL OR char_length(details) <= 5000),
  location_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dining_item_trip_fk
    FOREIGN KEY (itinerary_item_id, trip_id)
    REFERENCES itinerary_item(id, trip_id)
    ON DELETE CASCADE,
  CONSTRAINT dining_location_trip_fk
    FOREIGN KEY (location_id, trip_id)
    REFERENCES location(id, trip_id)
    ON DELETE SET NULL (location_id),
  UNIQUE (itinerary_item_id)
);

CREATE INDEX IF NOT EXISTS dining_location_idx
  ON dining_item (location_id)
  WHERE location_id IS NOT NULL;
