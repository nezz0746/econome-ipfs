import { getDb, onboardingTokens } from "@repo/db";
import { eq } from "drizzle-orm";

import { buildDockerJoinScript, buildFollowerBundle } from "@/lib/cluster-config";

// Public, token-gated endpoint — no session. The onboarding token is the
// credential. Always rendered dynamically (DB lookup + live cluster env).
export const dynamic = "force-dynamic";

function scriptResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** A script that just prints an error and exits non-zero, for `curl | bash`. */
function errorScript(message: string): string {
  return `#!/usr/bin/env bash\necho "Econome join failed: ${message}" >&2\nexit 1\n`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;

  const [row] = await getDb()
    .select({
      id: onboardingTokens.id,
      expiresAt: onboardingTokens.expiresAt,
    })
    .from(onboardingTokens)
    .where(eq(onboardingTokens.token, token))
    .limit(1);

  if (!row) {
    return scriptResponse(
      errorScript("invalid or unknown onboarding token."),
      404,
    );
  }

  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return scriptResponse(
      errorScript("this onboarding token has expired."),
      410,
    );
  }

  const bundle = buildFollowerBundle();
  if (!bundle.secret || !bundle.bootstrapMultiaddr) {
    return scriptResponse(
      errorScript(
        "the storage center is not fully configured (missing CLUSTER_SECRET or CLUSTER_BOOTSTRAP).",
      ),
      503,
    );
  }

  return scriptResponse(buildDockerJoinScript(bundle));
}
