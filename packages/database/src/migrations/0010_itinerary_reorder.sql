DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'itinerary_day_order_uq'
      AND conrelid = 'itinerary_item'::regclass
  ) THEN
    DROP INDEX IF EXISTS itinerary_day_order_uq;
    ALTER TABLE itinerary_item
      ADD COLUMN IF NOT EXISTS active_sort_order integer
      GENERATED ALWAYS AS (
        CASE WHEN deleted_at IS NULL THEN sort_order ELSE NULL END
      ) STORED;
    ALTER TABLE itinerary_item
      ADD CONSTRAINT itinerary_day_order_uq
      UNIQUE (trip_day_id, active_sort_order)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION reorder_itinerary_items(
  p_owner_id text,
  p_trip_id uuid,
  p_trip_day_id uuid,
  p_base_version integer,
  p_ordered_ids jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  current_version integer;
  next_version integer;
  current_ids uuid[];
  ordered_ids uuid[];
  event_id text;
BEGIN
  IF jsonb_typeof(p_ordered_ids) <> 'array'
    OR jsonb_array_length(p_ordered_ids) = 0
  THEN
    RAISE EXCEPTION 'ITINERARY_ORDER_SET_MISMATCH'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT day.version
  INTO current_version
  FROM trip_day day
  JOIN trip trip_row
    ON trip_row.id = day.trip_id
  WHERE day.id = p_trip_day_id
    AND day.trip_id = p_trip_id
    AND trip_row.owner_id = p_owner_id
    AND trip_row.status <> 'deleted'
  FOR UPDATE OF day;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITINERARY_ORDER_DAY_NOT_FOUND'
      USING ERRCODE = 'P0001';
  END IF;
  IF current_version <> p_base_version THEN
    RAISE EXCEPTION 'ITINERARY_ORDER_VERSION_CONFLICT'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(item.id ORDER BY item.sort_order, item.id)
  INTO current_ids
  FROM itinerary_item item
  WHERE item.trip_day_id = p_trip_day_id
    AND item.trip_id = p_trip_id
    AND item.owner_id = p_owner_id
    AND item.deleted_at IS NULL;

  SELECT array_agg(entry.value::uuid ORDER BY entry.ordinality)
  INTO ordered_ids
  FROM jsonb_array_elements_text(p_ordered_ids)
    WITH ORDINALITY AS entry(value, ordinality);

  IF current_ids IS NULL
    OR ordered_ids IS NULL
    OR cardinality(current_ids) <> cardinality(ordered_ids)
    OR cardinality(ordered_ids) <> (
      SELECT count(DISTINCT value)
      FROM jsonb_array_elements_text(p_ordered_ids)
    )
    OR NOT (current_ids @> ordered_ids AND ordered_ids @> current_ids)
  THEN
    RAISE EXCEPTION 'ITINERARY_ORDER_SET_MISMATCH'
      USING ERRCODE = 'P0001';
  END IF;

  SET CONSTRAINTS itinerary_day_order_uq DEFERRED;
  WITH desired AS (
    SELECT
      entry.value::uuid AS id,
      (entry.ordinality * 1024)::integer AS sort_order
    FROM jsonb_array_elements_text(p_ordered_ids)
      WITH ORDINALITY AS entry(value, ordinality)
  )
  UPDATE itinerary_item item
  SET
    sort_order = desired.sort_order,
    updated_at = clock_timestamp()
  FROM desired
  WHERE item.id = desired.id
    AND item.trip_day_id = p_trip_day_id
    AND item.trip_id = p_trip_id
    AND item.owner_id = p_owner_id
    AND item.deleted_at IS NULL;

  next_version := current_version + 1;
  UPDATE trip_day
  SET
    version = next_version,
    route_generation = route_generation + 1,
    updated_at = clock_timestamp()
  WHERE id = p_trip_day_id;

  event_id := concat(
    'itinerary-order:',
    p_trip_day_id::text,
    ':',
    next_version::text
  );
  INSERT INTO job_outbox (
    event_id,
    event_type,
    aggregate_type,
    aggregate_id,
    aggregate_version,
    schema_version
  )
  VALUES (
    event_id,
    'itinerary.order.changed',
    'trip_day',
    p_trip_day_id::text,
    next_version,
    1
  );

  RETURN jsonb_build_object(
    'tripDayId', p_trip_day_id,
    'version', next_version,
    'orderedIds', to_jsonb(ordered_ids),
    'eventId', event_id
  );
EXCEPTION
  WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'ITINERARY_ORDER_SET_MISMATCH'
      USING ERRCODE = 'P0001';
END;
$$;
