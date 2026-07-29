DROP TRIGGER IF EXISTS trip_guard_date_update ON trip;
DROP TRIGGER IF EXISTS trip_generate_days_after_insert ON trip;
DROP FUNCTION IF EXISTS apply_trip_date_range(text, uuid, integer, date, date, boolean);
DROP FUNCTION IF EXISTS trip_date_context(text, uuid);
DROP FUNCTION IF EXISTS trip_day_content_summary(uuid);
DROP FUNCTION IF EXISTS guard_trip_date_update();
DROP FUNCTION IF EXISTS generate_trip_days_after_insert();
DROP FUNCTION IF EXISTS insert_trip_date_days(uuid, date, date);
DROP TABLE IF EXISTS trip_day;
