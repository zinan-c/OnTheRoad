/**
 * PostgreSQL account adapter for the local password provider. The identity
 * service only depends on this narrow interface, so registration/invitation
 * can be added later without changing session semantics.
 */
export class PostgresLocalAccountStore {
  /** @param {{executor: import("@on-the-road/database/postgres").PostgresExecutor}} options */
  constructor({ executor }) {
    this.database = executor;
  }

  /** @param {string} username */
  async findByUsername(username) {
    const result = await this.database.query(
      `SELECT id, principal_id, username, password_hash, role, status,
              must_change_password, failed_login_count, locked_until
         FROM user_account
        WHERE username_normalized = lower(btrim($1))`,
      [username],
    );
    return mapAccount(result.rows[0]);
  }

  /** @param {string} accountId */
  async recordLoginFailure(accountId) {
    const result = await this.database.query(
      `UPDATE user_account
          SET failed_login_count = failed_login_count + 1,
              locked_until = CASE
                WHEN failed_login_count + 1 >= 5 THEN clock_timestamp() + interval '15 minutes'
                ELSE locked_until
              END,
              updated_at = clock_timestamp()
        WHERE id = $1::uuid
        RETURNING failed_login_count, locked_until`,
      [accountId],
    );
    return {
      failedLoginCount: Number(result.rows[0]?.failed_login_count ?? 0),
      lockedUntil: result.rows[0]?.locked_until?.toISOString?.() ?? null,
    };
  }

  /** @param {string} accountId */
  async recordLoginSuccess(accountId) {
    await this.database.query(
      `UPDATE user_account
          SET failed_login_count = 0,
              locked_until = NULL,
              last_login_at = clock_timestamp(),
              updated_at = clock_timestamp()
        WHERE id = $1::uuid`,
      [accountId],
    );
  }

  /** @param {string} accountId @param {string} passwordHash */
  async changePassword(accountId, passwordHash) {
    await this.database.query(
      `UPDATE user_account
          SET password_hash = $2,
              must_change_password = false,
              password_changed_at = clock_timestamp(),
              failed_login_count = 0,
              locked_until = NULL,
              updated_at = clock_timestamp()
        WHERE id = $1::uuid`,
      [accountId, passwordHash],
    );
  }
}

/** @param {any} row */
function mapAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    principalId: row.principal_id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
    mustChangePassword: row.must_change_password === true,
    failedLoginCount: Number(row.failed_login_count ?? 0),
    lockedUntil: row.locked_until?.toISOString?.() ?? row.locked_until ?? null,
  };
}
