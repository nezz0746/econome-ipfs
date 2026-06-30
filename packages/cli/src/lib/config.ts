export interface FollowerConfig {
  clusterName: string;
  compose: string;
  kuboInit: string;
}

/**
 * Fetch the rendered follower config from a dashboard join URL. The server
 * returns `{ clusterName, compose, kuboInit }` on success or `{ error }` for an
 * invalid/expired token or unconfigured cluster.
 */
export async function fetchFollowerConfig(
  url: string,
): Promise<FollowerConfig> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" } });
  } catch (err) {
    throw new Error(
      `Could not reach the dashboard at ${url}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(
      `The dashboard returned a non-JSON response (HTTP ${res.status}).`,
    );
  }

  if (body && typeof body === "object" && "error" in body) {
    throw new Error(String((body as { error: unknown }).error));
  }

  const cfg = body as Partial<FollowerConfig>;
  if (
    !cfg ||
    typeof cfg.compose !== "string" ||
    typeof cfg.kuboInit !== "string"
  ) {
    throw new Error("The dashboard response was missing the follower config.");
  }
  return {
    clusterName:
      typeof cfg.clusterName === "string" ? cfg.clusterName : "econome",
    compose: cfg.compose,
    kuboInit: cfg.kuboInit,
  };
}
