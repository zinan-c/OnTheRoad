DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM itinerary_item i
    WHERE i.transport_mode_code IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM reference_transport_mode r
        WHERE r.code = i.transport_mode_code
      )
  ) THEN
    RAISE EXCEPTION
      'cannot roll back transport modes while itinerary items reference custom codes';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS itinerary_transport_mode_code_guard
  ON itinerary_item;
DROP FUNCTION IF EXISTS validate_itinerary_transport_mode_code();
DROP VIEW IF EXISTS transport_mode_catalog;
DROP TRIGGER IF EXISTS custom_transport_mode_code_guard
  ON custom_transport_mode;
DROP FUNCTION IF EXISTS validate_custom_transport_mode_code();
DROP TABLE IF EXISTS custom_transport_mode;

ALTER TABLE itinerary_item
  ADD CONSTRAINT itinerary_item_transport_mode_code_fkey
  FOREIGN KEY (transport_mode_code)
  REFERENCES reference_transport_mode(code);
