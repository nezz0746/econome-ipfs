import { getDb, schema } from "@repo/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

/**
 * Server-side Better Auth instance. Backed by the shared Drizzle/Postgres
 * layer in `@repo/db`. Only ever imported in server code (route handlers,
 * server components, server actions) — never in the client or middleware.
 */
const isProd = process.env.NODE_ENV === "production";

function authSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (secret) return secret;
  if (isProd) {
    // Warn (don't throw) so production builds don't require runtime secrets.
    console.warn(
      "[auth] BETTER_AUTH_SECRET is not set; using an insecure fallback.",
    );
  }
  // Dev fallback so `pnpm dev` and CI builds work without env setup.
  return "dev-better-auth-secret-not-for-production";
}

export const auth = betterAuth({
  secret: authSecret(),
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  database: drizzleAdapter(getDb(), {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  // nextCookies must be the last plugin so it can flush Set-Cookie headers
  // from server actions.
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
