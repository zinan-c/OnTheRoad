CREATE OR REPLACE FUNCTION request_route_rebuild_days(p_day_ids uuid[])
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  day_id uuid;
  day_trip_id uuid;
  generation integer;
  rebuild_event_id text;
BEGIN
  FOR day_id IN
    SELECT DISTINCT days.value
    FROM unnest(p_day_ids) AS days(value)
    WHERE days.value IS NOT NULL
    ORDER BY days.value
  LOOP
    UPDATE trip_day
    SET route_generation = route_generation + 1,
        updated_at = clock_timestamp()
    WHERE id = day_id
    RETURNING trip_id, route_generation
    INTO day_trip_id, generation;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    UPDATE route_segment
    SET status = 'obsolete',
        updated_at = clock_timestamp()
    WHERE trip_id = day_trip_id
      AND status <> 'obsolete'
      AND (
        trip_day_id = day_id
        OR COALESCE(source_context->'dayIds', '[]'::jsonb) ? day_id::text
      );

    rebuild_event_id := concat(
      'route-rebuild:',
      day_id::text,
      ':',
      generation::text
    );
    INSERT INTO job_outbox (
      event_id, event_type, aggregate_type, aggregate_id,
      aggregate_version, schema_version
    )
    VALUES (
      rebuild_event_id,
      'route.rebuild.requested',
      'trip_day',
      day_id::text,
      generation,
      1
    )
    ON CONFLICT (event_id) DO NOTHING;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION itinerary_route_rebuild_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM request_route_rebuild_days(
    ARRAY(SELECT DISTINCT trip_day_id FROM new_items)
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION itinerary_route_rebuild_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM request_route_rebuild_days(
    ARRAY(
      SELECT DISTINCT trip_day_id
      FROM (
        SELECT trip_day_id FROM old_items
        UNION ALL
        SELECT trip_day_id FROM new_items
      ) changed
    )
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION itinerary_route_rebuild_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM request_route_rebuild_days(
    ARRAY(SELECT DISTINCT trip_day_id FROM old_items)
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS itinerary_route_rebuild_after_insert ON itinerary_item;
CREATE TRIGGER itinerary_route_rebuild_after_insert
AFTER INSERT ON itinerary_item
REFERENCING NEW TABLE AS new_items
FOR EACH STATEMENT EXECUTE FUNCTION itinerary_route_rebuild_insert();

DROP TRIGGER IF EXISTS itinerary_route_rebuild_after_update ON itinerary_item;
CREATE TRIGGER itinerary_route_rebuild_after_update
AFTER UPDATE ON itinerary_item
REFERENCING OLD TABLE AS old_items NEW TABLE AS new_items
FOR EACH STATEMENT EXECUTE FUNCTION itinerary_route_rebuild_update();

DROP TRIGGER IF EXISTS itinerary_route_rebuild_after_delete ON itinerary_item;
CREATE TRIGGER itinerary_route_rebuild_after_delete
AFTER DELETE ON itinerary_item
REFERENCING OLD TABLE AS old_items
FOR EACH STATEMENT EXECUTE FUNCTION itinerary_route_rebuild_delete();

CREATE OR REPLACE FUNCTION location_route_rebuild_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM request_route_rebuild_days(
    ARRAY(
      SELECT DISTINCT item.trip_day_id
      FROM new_locations location
      JOIN itinerary_item item
        ON item.location_id = location.id
        OR item.start_location_id = location.id
        OR item.end_location_id = location.id
      WHERE item.deleted_at IS NULL
    )
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS location_route_rebuild_after_update ON location;
CREATE TRIGGER location_route_rebuild_after_update
AFTER UPDATE ON location
REFERENCING NEW TABLE AS new_locations
FOR EACH STATEMENT EXECUTE FUNCTION location_route_rebuild_update();
