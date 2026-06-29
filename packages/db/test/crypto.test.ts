import { describe, expect, it } from "vitest";

import {
  generateApiKey,
  generateOnboardingToken,
  hashApiKey,
} from "../src/crypto";

describe("hashApiKey", () => {
  it("is deterministic and 64 hex chars (sha256)", () => {
    const a = hashApiKey("secret");
    const b = hashApiKey("secret");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different inputs", () => {
    expect(hashApiKey("a")).not.toBe(hashApiKey("b"));
  });
});

describe("generateApiKey", () => {
  it("is prefixed and unique", () => {
    const k1 = generateApiKey();
    const k2 = generateApiKey();
    expect(k1).toMatch(/^eco_[0-9a-f]{48}$/);
    expect(k1).not.toBe(k2);
  });
});

describe("generateOnboardingToken", () => {
  it("is prefixed", () => {
    expect(generateOnboardingToken()).toMatch(/^onb_[0-9a-f]{36}$/);
  });
});
