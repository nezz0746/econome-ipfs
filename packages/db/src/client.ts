import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

/**
 * Build a Drizzle client for the given connection string. Exposed as a factory
 * so the API (long-lived pool) and one-off scripts can each control lifecycle.
 */
export function createDb(connectionString: string) {
  const queryClient = postgres(connectionString);
  return drizzle(queryClient, { schema });
}

export type Database = ReturnType<typeof createDb>;

let cached: Database | undefined;

/**
 * Default connection string. postgres-js connects lazily (only on the first
 * query), so falling back here keeps `next build` working without a live DB
 * and lets `pnpm dev` run with zero env setup; real environments set
 * DATABASE_URL (and the compose/infra ports match this default).
 */
export const DEFAULT_DATABASE_URL =
  "postgres://postgres:postgres@localhost:5432/econome";

/** Process-wide singleton built lazily from DATABASE_URL. */
export function getDb(): Database {
  if (!cached) {
    cached = createDb(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
  }
  return cached;
}
