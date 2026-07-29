CREATE TABLE reference_currency (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$' AND code <> 'RMB'),
  label text NOT NULL,
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(aliases) = 'array'),
  is_system boolean NOT NULL DEFAULT true
);

CREATE TABLE reference_cost_category (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
  label text NOT NULL,
  icon text NOT NULL CHECK (icon ~ '^[a-z0-9-]+$'),
  color text NOT NULL CHECK (color ~ '^#[0-9A-F]{6}$'),
  is_system boolean NOT NULL DEFAULT true
);

CREATE TABLE reference_transport_mode (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
  label text NOT NULL,
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(aliases) = 'array'),
  icon text NOT NULL CHECK (icon ~ '^[a-z0-9-]+$'),
  color text NOT NULL CHECK (color ~ '^#[0-9A-F]{6}$'),
  line_style text NOT NULL CHECK (line_style IN ('solid', 'dashed', 'dotted')),
  is_system boolean NOT NULL DEFAULT true
);

CREATE OR REPLACE FUNCTION protect_system_reference_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_system THEN
    RAISE EXCEPTION 'system reference row cannot be deleted: %', OLD.code
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER reference_currency_protect_system
BEFORE DELETE ON reference_currency
FOR EACH ROW EXECUTE FUNCTION protect_system_reference_row();

CREATE TRIGGER reference_cost_category_protect_system
BEFORE DELETE ON reference_cost_category
FOR EACH ROW EXECUTE FUNCTION protect_system_reference_row();

CREATE TRIGGER reference_transport_mode_protect_system
BEFORE DELETE ON reference_transport_mode
FOR EACH ROW EXECUTE FUNCTION protect_system_reference_row();
