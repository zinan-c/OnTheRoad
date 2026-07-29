DROP FUNCTION IF EXISTS transition_location(text, uuid, integer, text, jsonb);
DROP FUNCTION IF EXISTS create_location(jsonb);
DROP FUNCTION IF EXISTS location_as_json(uuid);
DROP TABLE IF EXISTS geocoding_job;
DROP TABLE IF EXISTS import_location_staging;
DROP TABLE IF EXISTS location;
DROP INDEX IF EXISTS trip_id_owner_unique_idx;
