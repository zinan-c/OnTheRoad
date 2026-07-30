CREATE TABLE IF NOT EXISTS trip_exchange_rate (
  trip_id uuid NOT NULL,
  owner_id text NOT NULL,
  from_currency text NOT NULL REFERENCES reference_currency(code),
  to_currency text NOT NULL REFERENCES reference_currency(code),
  rate numeric(28,12) NOT NULL CHECK (rate > 0),
  source text NOT NULL DEFAULT 'manual' CHECK (source = 'manual'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  effective_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, from_currency, to_currency),
  CONSTRAINT exchange_rate_trip_owner_fk
    FOREIGN KEY (trip_id, owner_id)
    REFERENCES trip(id, owner_id)
    ON DELETE CASCADE,
  CHECK (from_currency <> to_currency)
);

CREATE INDEX IF NOT EXISTS exchange_rate_owner_trip_idx
  ON trip_exchange_rate (owner_id, trip_id, updated_at DESC);
