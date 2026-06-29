import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { DEFAULT_DATABASE_URL } from "./client";

/**
 * Apply pending migrations from the package's `drizzle/` folder. Idempotent —
 * safe to run on every API boot. Falls back to the dev default connection so
 * `pnpm dev` works with zero env setup. Uses a dedicated single connection
 * that is closed when done.
 */
export async function runMigrations(
  connectionString = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
): Promise<void> {
  const migrationsFolder = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "drizzle",
  );
  const sql = postgres(connectionString, { max: 1 });
  try {
    await migrate(drizzle(sql), { migrationsFolder });
  } finally {
    await sql.end();
  }
}
