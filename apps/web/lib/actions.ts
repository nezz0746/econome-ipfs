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
import { ingest } from "@/lib/api";
import { auth } from "@/lib/auth";

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

/** Mint a single-use onboarding token for a new participant. */
export async function createOnboardingToken(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const label = String(formData.get("label") ?? "").trim() || null;
  await getDb()
    .insert(onboardingTokens)
    .values({ token: generateOnboardingToken(), label, createdBy: userId });
  revalidatePath("/dashboard/onboarding");
}

/** Forward a test upload through the API ingest endpoint. */
export async function testUpload(
  formData: FormData,
): Promise<{ cid?: string; error?: string }> {
  await requireUserId();
  const apiKey = String(formData.get("apiKey") ?? "");
  const file = formData.get("file");
  if (!apiKey) return { error: "API key required" };
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file" };
  }
  try {
    const result = await ingest(apiKey, file);
    return { cid: result.cid };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "upload failed" };
  }
}
