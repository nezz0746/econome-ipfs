import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { apiKeyAuth, hashApiKey, internalAuth } from "../src/auth";

describe("apiKeyAuth", () => {
  const findApiKey = async (hashed: string) =>
    hashed === hashApiKey("good-key") ? { id: "key-1" } : undefined;

  const app = new Hono<{ Variables: { apiKeyId: string } }>();
  app.use("/protected", apiKeyAuth(findApiKey));
  app.get("/protected", (c) => c.json({ apiKeyId: c.get("apiKeyId") }));

  it("rejects when no key is provided", async () => {
    const res = await app.request("/protected");
    expect(res.status).toBe(401);
  });

  it("rejects an unknown key", async () => {
    const res = await app.request("/protected", {
      headers: { "x-api-key": "nope" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts a valid bearer key and sets apiKeyId", async () => {
    const res = await app.request("/protected", {
      headers: { authorization: "Bearer good-key" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ apiKeyId: "key-1" });
  });
});

describe("internalAuth", () => {
  const app = new Hono();
  app.use("/i", internalAuth("secret-token"));
  app.get("/i", (c) => c.json({ ok: true }));

  it("rejects a wrong token", async () => {
    const res = await app.request("/i", {
      headers: { "x-internal-token": "wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts the correct token", async () => {
    const res = await app.request("/i", {
      headers: { "x-internal-token": "secret-token" },
    });
    expect(res.status).toBe(200);
  });
});
