import { getDb, onboardingTokens } from "@repo/db";
import { eq } from "drizzle-orm";

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

  let peerId: unknown;
  try {
    peerId = ((await request.json()) as { peerId?: unknown })?.peerId;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  if (typeof peerId !== "string" || peerId.length === 0) {
    return json({ error: "peerId is required" }, 400);
  }

  const db = getDb();
  const [row] = await db
    .select({ id: onboardingTokens.id })
    .from(onboardingTokens)
    .where(eq(onboardingTokens.token, token))
    .limit(1);

  if (!row) {
    return json({ error: "invalid or unknown onboarding token" }, 404);
  }

  await db
    .update(onboardingTokens)
    .set({ usedByPeerId: peerId })
    .where(eq(onboardingTokens.id, row.id));

  return json({ ok: true });
}
