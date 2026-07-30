DROP FUNCTION IF EXISTS reorder_itinerary_items(
  text,
  uuid,
  uuid,
  integer,
  jsonb
);

ALTER TABLE itinerary_item
  DROP CONSTRAINT IF EXISTS itinerary_day_order_uq;

ALTER TABLE itinerary_item
  DROP COLUMN IF EXISTS active_sort_order;

CREATE UNIQUE INDEX IF NOT EXISTS itinerary_day_order_uq
  ON itinerary_item (trip_day_id, sort_order)
  WHERE deleted_at IS NULL;
