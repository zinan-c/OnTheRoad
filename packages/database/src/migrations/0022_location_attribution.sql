ALTER TABLE location
  ADD COLUMN IF NOT EXISTS attribution text;

\ir ../schema/location.sql
