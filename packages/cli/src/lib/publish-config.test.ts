import { describe, expect, it } from "vitest";
import {
  DEFAULT_API_URL,
  DEFAULT_GATEWAY_URL,
  explainMissing,
  normalizeOrigin,
  resolvePublishConfig,
} from "./publish-config";

describe("normalizeOrigin", () => {
  it("strips trailing slashes and surrounding space", () => {
    expect(normalizeOrigin("  https://h.example//  ")).toBe(
      "https://h.example",
    );
  });
});

describe("resolvePublishConfig", () => {
  it("falls back to the public defaults", () => {
    const cfg = resolvePublishConfig({ env: {} });
    expect(cfg.apiUrl).toBe(DEFAULT_API_URL);
    expect(cfg.gatewayUrl).toBe(DEFAULT_GATEWAY_URL);
    expect(cfg.apiKey).toBe("");
  });

  it("reads the key and origins from the environment", () => {
    const cfg = resolvePublishConfig({
      env: {
        ECONOME_API_KEY: "eco_live",
        ECONOME_API_URL: "https://api.example/",
        ECONOME_GATEWAY_URL: "https://gw.example/",
      },
    });
    expect(cfg).toEqual({
      apiKey: "eco_live",
      apiUrl: "https://api.example",
      gatewayUrl: "https://gw.example",
    });
  });

  it("prefers the environment over the stored config", () => {
    const cfg = resolvePublishConfig({
      env: {
        ECONOME_API_KEY: "from_env",
        ECONOME_API_URL: "https://env.example",
      },
      stored: { apiKey: "from_file", apiUrl: "https://file.example" },
    });
    expect(cfg.apiKey).toBe("from_env");
    expect(cfg.apiUrl).toBe("https://env.example");
  });

  it("uses the stored config when the environment is empty", () => {
    const cfg = resolvePublishConfig({
      env: {},
      stored: { apiKey: "from_file", apiUrl: "https://file.example" },
    });
    expect(cfg.apiKey).toBe("from_file");
    expect(cfg.apiUrl).toBe("https://file.example");
  });

  it("lets a flag override the environment", () => {
    const cfg = resolvePublishConfig({
      env: { ECONOME_API_URL: "https://env.example" },
      flags: { apiUrl: "https://flag.example" },
    });
    expect(cfg.apiUrl).toBe("https://flag.example");
  });
});

describe("explainMissing", () => {
  it("reports a missing key", () => {
    const msg = explainMissing({
      apiKey: "",
      apiUrl: DEFAULT_API_URL,
      gatewayUrl: DEFAULT_GATEWAY_URL,
    });
    expect(msg).toContain("No API key");
  });

  it("rejects a non-http API url", () => {
    const msg = explainMissing({
      apiKey: "k",
      apiUrl: "ftp://nope",
      gatewayUrl: DEFAULT_GATEWAY_URL,
    });
    expect(msg).toContain("Invalid API URL");
  });

  it("accepts a usable config", () => {
    expect(
      explainMissing({
        apiKey: "k",
        apiUrl: DEFAULT_API_URL,
        gatewayUrl: DEFAULT_GATEWAY_URL,
      }),
    ).toBeNull();
  });
});
