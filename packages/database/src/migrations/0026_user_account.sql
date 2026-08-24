CREATE TABLE IF NOT EXISTS user_account (
  id uuid PRIMARY KEY,
  principal_id text NOT NULL UNIQUE CHECK (char_length(principal_id) BETWEEN 1 AND 255),
  username text NOT NULL CHECK (char_length(btrim(username)) BETWEEN 1 AND 80),
  username_normalized text GENERATED ALWAYS AS (lower(btrim(username))) STORED,
  password_hash text NOT NULL CHECK (char_length(password_hash) BETWEEN 32 AND 1000),
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  must_change_password boolean NOT NULL DEFAULT true,
  failed_login_count integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until timestamptz,
  last_login_at timestamptz,
  password_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_account_username_normalized_uq
  ON user_account (username_normalized);

CREATE INDEX IF NOT EXISTS user_account_status_idx
  ON user_account (status, username_normalized);
