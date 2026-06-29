import { hashApiKey } from "@repo/db";
import type { Context, MiddlewareHandler } from "hono";

export { hashApiKey };

/** Extract a bearer token or x-api-key header value. */
function readApiKey(c: Context): string | undefined {
  const auth = c.req.header("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return c.req.header("x-api-key") ?? undefined;
}

export interface ApiKeyRecord {
  id: string;
}

/**
 * Gate a route on a valid, non-revoked API key. `findApiKey` is injected so the
 * middleware can be tested without a database; it receives the hashed key.
 */
export function apiKeyAuth(
  findApiKey: (hashedKey: string) => Promise<ApiKeyRecord | undefined>,
): MiddlewareHandler {
  return async (c, next) => {
    const raw = readApiKey(c);
    if (!raw) {
      return c.json({ error: "missing api key" }, 401);
    }
    const record = await findApiKey(hashApiKey(raw));
    if (!record) {
      return c.json({ error: "invalid api key" }, 401);
    }
    c.set("apiKeyId", record.id);
    await next();
  };
}

/** Gate a route on the shared internal service token (used by the Next BFF). */
export function internalAuth(token: string): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.header("x-internal-token") !== token) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}
