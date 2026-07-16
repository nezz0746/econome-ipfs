import { getDb, onboardingTokens, participants } from "@repo/db";
import { eq } from "drizzle-orm";

import { parseTags } from "@/lib/tags";

// Public, token-gated: the token in the path is the credential.
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;

  let body: { peerId?: unknown; tags?: unknown };
  try {
    body = (await request.json()) as { peerId?: unknown; tags?: unknown };
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const peerId = body?.peerId;
  if (typeof peerId !== "string" || peerId.length === 0) {
    return json({ error: "peerId is required" }, 400);
  }
  // Explicit tags from the CLI (--tags). Absent -> the token's defaults.
  const cliTags = body?.tags === undefined ? undefined : parseTags(body.tags);
  if (cliTags === null) {
    return json(
      { error: "invalid 'tags': comma-separated lowercase slugs expected" },
      400,
    );
  }

  const db = getDb();
  const [row] = await db
    .select({
      id: onboardingTokens.id,
      label: onboardingTokens.label,
      tags: onboardingTokens.tags,
    })
    .from(onboardingTokens)
    .where(eq(onboardingTokens.token, token))
    .limit(1);

  if (!row) {
    return json({ error: "invalid or unknown onboarding token" }, 404);
  }

  const subscribedTags = cliTags ?? row.tags;

  await db
    .update(onboardingTokens)
    .set({ usedByPeerId: peerId })
    .where(eq(onboardingTokens.id, row.id));

  // Create the participant right away (rather than waiting for the first
  // accounting tick) so its tag subscriptions apply to the next tagged pin.
  await db
    .insert(participants)
    .values({
      peerId,
      label: row.label,
      subscribedTags,
      onboardingTokenId: row.id,
    })
    .onConflictDoUpdate({
      target: participants.peerId,
      set: {
        label: row.label,
        subscribedTags,
        onboardingTokenId: row.id,
        lastSeenAt: new Date(),
      },
    });

  return json({ ok: true, tags: subscribedTags });
}
