ALTER TABLE trip
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

UPDATE trip
SET last_activity_at = COALESCE(last_activity_at, updated_at, created_at, clock_timestamp())
WHERE last_activity_at IS NULL;

ALTER TABLE trip
  ALTER COLUMN last_activity_at SET DEFAULT now(),
  ALTER COLUMN last_activity_at SET NOT NULL;

DROP INDEX IF EXISTS trip_owner_status_updated_idx;
DROP INDEX IF EXISTS trip_owner_currency_idx;

CREATE INDEX IF NOT EXISTS trip_owner_status_activity_idx
  ON trip (owner_id, status, last_activity_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS trip_owner_currency_idx
  ON trip (owner_id, default_currency, last_activity_at DESC, id DESC);

-- Keep this migration independent from future trip schema changes. The full
-- lifecycle function set is re-applied by migration 0028 after its column is
-- present; this version only needs the activity-aware JSON projection.
\ir ../schema/trip-activity-json.sql

CREATE OR REPLACE FUNCTION set_trip_last_activity_before_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.last_activity_at IS NOT DISTINCT FROM OLD.last_activity_at THEN
    NEW.last_activity_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_set_last_activity_before_update ON trip;
CREATE TRIGGER trip_set_last_activity_before_update
BEFORE UPDATE ON trip
FOR EACH ROW EXECUTE FUNCTION set_trip_last_activity_before_update();

CREATE OR REPLACE FUNCTION touch_trip_last_activity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  related_trip_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    related_trip_id := OLD.trip_id;
  ELSE
    related_trip_id := NEW.trip_id;
  END IF;

  IF related_trip_id IS NOT NULL THEN
    UPDATE trip
    SET last_activity_at = clock_timestamp()
    WHERE id = related_trip_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'destination',
    'trip_day',
    'trip_audit',
    'itinerary_item',
    'itinerary_item_audit',
    'dining_item',
    'accommodation',
    'expense',
    'trip_exchange_rate',
    'location',
    'location_coordinate_audit',
    'import_location_staging',
    'geocoding_job',
    'route_segment',
    'custom_transport_mode',
    'attachment',
    'import_inspect_job',
    'import_job',
    'import_commit_ledger',
    'import_fingerprint_claim',
    'geocoding_batch',
    'staged_location_decision',
    'export_job',
    'import_override_decision',
    'import_media_task'
  ]
  LOOP
    IF to_regclass(table_name) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', table_name || '_touch_trip_activity', table_name);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION touch_trip_last_activity()',
      table_name || '_touch_trip_activity', table_name
    );
  END LOOP;
END;
$$;
