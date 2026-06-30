import { getDb, onboardingTokens } from "@repo/db";
import { eq } from "drizzle-orm";

import { buildFollowerBundle } from "@/lib/cluster-config";
import {
  buildDockerJoinScript,
  buildFollowerComposeFiles,
  wantsJson,
} from "@/lib/follower-compose";

// Public, token-gated endpoint — no session. The onboarding token is the
// credential. Always rendered dynamically (DB lookup + live cluster env).
export const dynamic = "force-dynamic";

function scriptResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * Error result. Both paths return HTTP 200 with a readable body: the bash path
 * prints + exits 1 (survives `curl -fsSL`, where `-f` discards error-status
 * bodies); the JSON path returns `{ error }` for the CLI to display.
 */
function errorResult(json: boolean, message: string): Response {
  if (json) return jsonResponse({ error: message });
  return scriptResponse(
    `#!/usr/bin/env bash\necho "Econome join failed: ${message}" >&2\nexit 1\n`,
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const json = wantsJson(request.headers.get("accept"));

  const [row] = await getDb()
    .select({
      id: onboardingTokens.id,
      expiresAt: onboardingTokens.expiresAt,
    })
    .from(onboardingTokens)
    .where(eq(onboardingTokens.token, token))
    .limit(1);

  if (!row) {
    return errorResult(json, "invalid or unknown onboarding token.");
  }
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return errorResult(json, "this onboarding token has expired.");
  }

  const bundle = buildFollowerBundle();
  if (!bundle.secret || !bundle.bootstrapMultiaddr) {
    return errorResult(
      json,
      "the storage center is not yet configured for joins (the operator must set CLUSTER_BOOTSTRAP, and CLUSTER_SECRET, on the dashboard).",
    );
  }

  if (json) {
    const { composeYaml, kuboInitSh } = buildFollowerComposeFiles(bundle);
    return jsonResponse({
      clusterName: bundle.clusterName,
      compose: composeYaml,
      kuboInit: kuboInitSh,
    });
  }

  return scriptResponse(buildDockerJoinScript(bundle));
}
