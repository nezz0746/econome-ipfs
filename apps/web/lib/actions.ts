"use server";

import {
  apiKeys,
  encryptSecret,
  generateApiKey,
  generateOnboardingToken,
  getDb,
  hashApiKey,
  onboardingTokens,
} from "@repo/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getEnrichedPeers, ingest } from "@/lib/api";
import { auth } from "@/lib/auth";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/upload-config";

async function requireUserId(): Promise<string> {
  const { headers } = await import("next/headers");
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("unauthorized");
  return session.user.id;
}

/** Create an API key. Returns the raw key, which is shown to the user once. */
export async function createApiKey(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const label = String(formData.get("label") ?? "").trim() || "unnamed";
  const raw = generateApiKey();

  await getDb()
    .insert(apiKeys)
    .values({
      label,
      hashedKey: hashApiKey(raw),
      encryptedKey: encryptSecret(raw),
      createdBy: userId,
    });

  // Surface the raw key once via a redirect query param.
  const { redirect } = await import("next/navigation");
  revalidatePath("/dashboard/api-keys");
  redirect(`/dashboard/api-keys?created=${encodeURIComponent(raw)}`);
}

export async function revokeApiKey(formData: FormData): Promise<void> {
  await requireUserId();
  const id = String(formData.get("id"));
  await getDb()
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(apiKeys.id, id));
  revalidatePath("/dashboard/api-keys");
}

/**
 * Force a fresh geo lookup for every peer's public IP, bypassing the 30-day
 * geo cache, then revalidate the Peers page so the new locations render.
 */
export async function refreshPeerLocations(): Promise<void> {
  await requireUserId();
  await getEnrichedPeers({ refresh: true });
  revalidatePath("/dashboard/peers");
}

/** Mint a single-use onboarding token for a new participant. */
export async function createOnboardingToken(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const label = String(formData.get("label") ?? "").trim() || null;
  await getDb()
    .insert(onboardingTokens)
    .values({ token: generateOnboardingToken(), label, createdBy: userId });
  revalidatePath("/dashboard/onboarding");
}

export interface UploadResult {
  name: string;
  cid?: string;
  error?: string;
}

/**
 * Forward a single test upload through the API ingest endpoint. The client
 * calls this once per file so each file gets its own request (and its own
 * {@link MAX_UPLOAD_BYTES} budget) rather than sharing one body limit.
 */
export async function testUpload(formData: FormData): Promise<UploadResult> {
  await requireUserId();
  const apiKey = String(formData.get("apiKey") ?? "");
  const file = formData.get("file");
  const name = file instanceof File ? file.name : "file";
  if (!apiKey) return { name, error: "API key required" };
  if (!(file instanceof File) || file.size === 0) {
    return { name, error: "Choose a file" };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { name, error: `Too large (max ${MAX_UPLOAD_MB} MB)` };
  }
  try {
    const result = await ingest(apiKey, file);
    return { name, cid: result.cid };
  } catch (err) {
    return {
      name,
      error: err instanceof Error ? err.message : "upload failed",
    };
  }
}
