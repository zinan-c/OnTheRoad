CREATE TABLE IF NOT EXISTS expense (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  owner_id text NOT NULL,
  trip_day_id uuid,
  itinerary_item_id uuid,
  destination_id uuid,
  category_code text NOT NULL REFERENCES reference_cost_category(code),
  transport_mode_code text,
  original_amount numeric(20,4) NOT NULL CHECK (original_amount >= 0),
  original_currency text NOT NULL REFERENCES reference_currency(code),
  settlement_amount numeric(20,4),
  settlement_currency text NOT NULL REFERENCES reference_currency(code),
  exchange_rate_snapshot numeric(28,12),
  source text NOT NULL DEFAULT 'actual'
    CHECK (source IN ('actual', 'route_estimate')),
  remark text CHECK (remark IS NULL OR char_length(remark) <= 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  incurred_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expense_trip_owner_fk
    FOREIGN KEY (trip_id, owner_id)
    REFERENCES trip(id, owner_id)
    ON DELETE CASCADE,
  CONSTRAINT expense_day_trip_fk
    FOREIGN KEY (trip_day_id, trip_id)
    REFERENCES trip_day(id, trip_id)
    ON DELETE SET NULL (trip_day_id),
  CONSTRAINT expense_item_trip_fk
    FOREIGN KEY (itinerary_item_id, trip_id)
    REFERENCES itinerary_item(id, trip_id)
    ON DELETE SET NULL (itinerary_item_id),
  CONSTRAINT expense_destination_trip_fk
    FOREIGN KEY (destination_id, trip_id)
    REFERENCES destination(id, trip_id)
    ON DELETE SET NULL (destination_id),
  CHECK (
    (settlement_amount IS NULL AND exchange_rate_snapshot IS NULL)
    OR
    (
      settlement_amount IS NOT NULL
      AND exchange_rate_snapshot IS NOT NULL
      AND exchange_rate_snapshot > 0
    )
  ),
  CHECK (
    original_currency <> settlement_currency
    OR exchange_rate_snapshot IS NULL
    OR exchange_rate_snapshot = 1
  )
);

CREATE INDEX IF NOT EXISTS expense_trip_day_idx
  ON expense (trip_id, trip_day_id);
CREATE INDEX IF NOT EXISTS expense_trip_category_idx
  ON expense (trip_id, category_code);
CREATE INDEX IF NOT EXISTS expense_owner_trip_actual_idx
  ON expense (owner_id, trip_id, created_at, id)
  WHERE source = 'actual';
