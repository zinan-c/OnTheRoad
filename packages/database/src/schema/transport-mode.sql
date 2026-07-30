CREATE TABLE IF NOT EXISTS custom_transport_mode (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  owner_id text NOT NULL,
  code text NOT NULL
    CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  label text NOT NULL
    CHECK (char_length(btrim(label)) BETWEEN 1 AND 80),
  icon text NOT NULL
    CHECK (icon ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  color varchar(9) NOT NULL
    CHECK (color ~ '^#[0-9A-F]{6}([0-9A-F]{2})?$'),
  line_style text NOT NULL
    CHECK (line_style IN ('solid', 'dashed', 'dotted', 'arc')),
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT custom_transport_mode_trip_owner_fk
    FOREIGN KEY (trip_id, owner_id)
    REFERENCES trip(id, owner_id)
    ON DELETE CASCADE,
  UNIQUE (trip_id, code),
  UNIQUE (id, trip_id)
);

CREATE INDEX IF NOT EXISTS custom_transport_mode_owner_trip_idx
  ON custom_transport_mode (owner_id, trip_id, enabled, code);

CREATE OR REPLACE FUNCTION validate_custom_transport_mode_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM reference_transport_mode r WHERE r.code = NEW.code
  ) THEN
    RAISE EXCEPTION 'TRANSPORT_MODE_CODE_CONFLICT'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS custom_transport_mode_code_guard
  ON custom_transport_mode;
CREATE TRIGGER custom_transport_mode_code_guard
BEFORE INSERT OR UPDATE OF code ON custom_transport_mode
FOR EACH ROW EXECUTE FUNCTION validate_custom_transport_mode_code();

CREATE OR REPLACE VIEW transport_mode_catalog AS
SELECT
  'system:' || r.code AS id,
  NULL::uuid AS trip_id,
  NULL::text AS owner_id,
  r.code,
  r.label,
  r.icon,
  r.color,
  r.line_style,
  true AS is_system,
  true AS enabled,
  1 AS version
FROM reference_transport_mode r
UNION ALL
SELECT
  c.id::text AS id,
  c.trip_id,
  c.owner_id,
  c.code,
  c.label,
  c.icon,
  c.color,
  c.line_style,
  false AS is_system,
  c.enabled,
  c.version
FROM custom_transport_mode c;

ALTER TABLE itinerary_item
  DROP CONSTRAINT IF EXISTS itinerary_item_transport_mode_code_fkey;

CREATE OR REPLACE FUNCTION validate_itinerary_transport_mode_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.transport_mode_code IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM reference_transport_mode r
    WHERE r.code = NEW.transport_mode_code
  ) OR EXISTS (
    SELECT 1
    FROM custom_transport_mode c
    WHERE c.trip_id = NEW.trip_id
      AND c.owner_id = NEW.owner_id
      AND c.code = NEW.transport_mode_code
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'TRANSPORT_MODE_NOT_FOUND'
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS itinerary_transport_mode_code_guard
  ON itinerary_item;
CREATE TRIGGER itinerary_transport_mode_code_guard
BEFORE INSERT OR UPDATE OF trip_id, owner_id, transport_mode_code
ON itinerary_item
FOR EACH ROW EXECUTE FUNCTION validate_itinerary_transport_mode_code();
