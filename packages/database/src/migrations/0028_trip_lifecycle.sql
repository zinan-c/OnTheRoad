ALTER TABLE trip
  ADD COLUMN IF NOT EXISTS status_before_delete text;

UPDATE trip
SET status_before_delete = 'active'
WHERE status = 'deleted' AND status_before_delete IS NULL;

ALTER TABLE trip
  DROP CONSTRAINT IF EXISTS trip_status_before_delete_check,
  DROP CONSTRAINT IF EXISTS trip_deleted_state_check;

ALTER TABLE trip
  ADD CONSTRAINT trip_status_before_delete_check
    CHECK (status_before_delete IS NULL OR status_before_delete IN ('draft', 'active', 'archived')),
  ADD CONSTRAINT trip_deleted_state_check
    CHECK (
      (status = 'deleted' AND deleted_at IS NOT NULL AND status_before_delete IS NOT NULL)
      OR (status <> 'deleted' AND deleted_at IS NULL AND status_before_delete IS NULL)
    );

-- Re-apply trip transition functions with draft/archive and restore-to-previous
-- semantics after the compatibility column has been added.
\ir ../schema/trip.sql
