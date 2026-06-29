import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/** Deterministic hash used to store and look up API keys. */
export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Derive a 32-byte AES key from ENCRYPTION_KEY (any length input is hashed to
 * 32 bytes). Falls back to a dev value so `pnpm dev` works without env setup;
 * production should set ENCRYPTION_KEY.
 */
function encryptionKey(): Buffer {
  const material =
    process.env.ENCRYPTION_KEY ?? "dev-encryption-key-not-for-production";
  return createHash("sha256").update(material).digest();
}

/** Encrypt a secret with AES-256-GCM. Returns `iv:tag:ciphertext` (base64). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    enc.toString("base64"),
  ].join(":");
}

/** Decrypt a value produced by `encryptSecret`. Returns null if it can't. */
export function decryptSecret(payload: string | null): string | null {
  if (!payload) return null;
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** Generate a new opaque API key (shown to the user once). */
export function generateApiKey(): string {
  return `eco_${randomBytes(24).toString("hex")}`;
}

/** Generate an onboarding token for a new participant. */
export function generateOnboardingToken(): string {
  return `onb_${randomBytes(18).toString("hex")}`;
}
