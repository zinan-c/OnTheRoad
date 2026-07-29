DROP FUNCTION IF EXISTS transition_trip(text, uuid, integer, text);
DROP FUNCTION IF EXISTS update_trip(text, uuid, integer, jsonb);
DROP FUNCTION IF EXISTS create_trip(text, text, text, jsonb);
DROP FUNCTION IF EXISTS trip_as_json(uuid);
DROP TABLE IF EXISTS trip_create_request;
DROP TABLE IF EXISTS trip_audit;
DROP TABLE IF EXISTS destination;
DROP TABLE IF EXISTS trip;
