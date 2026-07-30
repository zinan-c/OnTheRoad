import {
  costCategories,
  currencies,
  transportModes,
} from "@on-the-road/config/reference-data";
import type { Pool } from "pg";

export async function seedSystemReferenceData(pool: Pool): Promise<{
  currencies: number;
  costCategories: number;
  transportModes: number;
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
    await client.query("COMMIT");
    return {
      currencies: currencies.length,
      costCategories: costCategories.length,
      transportModes: transportModes.length,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
