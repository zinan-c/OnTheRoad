import { createHash, randomUUID } from "node:crypto";

import {
  costCategories,
  currencies,
  transportModes,
} from "@on-the-road/config/reference-data";
import { hashPassword } from "./password.js";
import type { Pool } from "pg";

const DEFAULT_ADMIN_USERNAME = "adminA";
const DEFAULT_ADMIN_PASSWORD = "Admin_1234";
const DEFAULT_LOCAL_ISSUER = "https://identity.on-the-road.local";

export async function seedSystemReferenceData(
  pool: Pool,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<{
  currencies: number;
  costCategories: number;
  transportModes: number;
  adminAccounts: number;
}> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const currency of currencies) {
      await client.query(
        `INSERT INTO reference_currency (code, label, aliases, is_system)
         VALUES ($1, $2, $3::jsonb, true)
         ON CONFLICT (code) DO UPDATE
           SET label = EXCLUDED.label, aliases = EXCLUDED.aliases, is_system = true`,
        [currency.code, currency.label, JSON.stringify(currency.aliases)],
      );
    }
    for (const category of costCategories) {
      await client.query(
        `INSERT INTO reference_cost_category (code, label, icon, color, is_system)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (code) DO UPDATE
           SET label = EXCLUDED.label,
               icon = EXCLUDED.icon,
               color = EXCLUDED.color,
               is_system = true`,
        [category.code, category.label, category.icon, category.color],
      );
    }
    for (const mode of transportModes) {
      await client.query(
        `INSERT INTO reference_transport_mode
           (code, label, aliases, icon, color, line_style, is_system)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, true)
         ON CONFLICT (code) DO UPDATE
           SET label = EXCLUDED.label,
               aliases = EXCLUDED.aliases,
               icon = EXCLUDED.icon,
               color = EXCLUDED.color,
               line_style = EXCLUDED.line_style,
               is_system = true`,
        [
          mode.code,
          mode.label,
          JSON.stringify(mode.aliases),
          mode.icon,
          mode.color,
          mode.lineStyle,
        ],
      );
    }
    const adminUsername = environment.OTR_BOOTSTRAP_ADMIN_USERNAME?.trim()
      || DEFAULT_ADMIN_USERNAME;
    const adminPassword = environment.OTR_BOOTSTRAP_ADMIN_PASSWORD?.trim()
      || DEFAULT_ADMIN_PASSWORD;
    const profile = environment.OTR_RUNTIME_PROFILE?.trim() || "dev";
    const productionLike = profile === "qa"
      || profile === "release"
      || environment.NODE_ENV?.trim() === "production";
    if (productionLike && (
      !environment.OTR_BOOTSTRAP_ADMIN_PASSWORD?.trim()
      || adminPassword === DEFAULT_ADMIN_PASSWORD
    )) {
      throw new Error(
        "OTR_BOOTSTRAP_ADMIN_PASSWORD must be injected and must not use the local development default outside dev.",
      );
    }
    const minimumLength = productionLike ? 16 : 10;
    if (adminPassword.length < minimumLength) {
      throw new Error(`OTR_BOOTSTRAP_ADMIN_PASSWORD must contain at least ${minimumLength} characters.`);
    }
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM user_account WHERE username_normalized = lower(btrim($1))`,
      [adminUsername],
    );
    if (existing.rowCount === 0) {
      const id = randomUUID();
      const issuer = environment.OTR_LOCAL_IDENTITY_ISSUER?.trim() || DEFAULT_LOCAL_ISSUER;
      const principalId = createHash("sha256")
        .update(`${new URL(issuer).href}\u0000${id}`)
        .digest("base64url");
      await client.query(
        `INSERT INTO user_account
           (id, principal_id, username, password_hash, role, status, must_change_password)
         VALUES ($1::uuid, $2, $3, $4, 'admin', 'active', $5)`,
        [id, principalId, adminUsername, await hashPassword(adminPassword), environment.OTR_BOOTSTRAP_ADMIN_FORCE_PASSWORD_CHANGE !== "false"],
      );
    }
    await client.query("COMMIT");
    return {
      currencies: currencies.length,
      costCategories: costCategories.length,
      transportModes: transportModes.length,
      adminAccounts: 1,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
