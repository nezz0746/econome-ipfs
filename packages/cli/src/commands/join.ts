import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join as pathJoin } from "node:path";
import * as p from "@clack/prompts";
import { fetchFollowerConfig } from "../lib/config.js";
import { composeExec, composeUp, dockerAvailable } from "../lib/docker.js";
import { parseJoinUrl } from "../lib/join-url.js";
import { pollPeerId } from "../lib/peer.js";
import { projectDir, writeProject } from "../lib/project.js";
import { registerPeer } from "../lib/register.js";
import { parseTagsInput } from "../lib/tags.js";

export async function join(url?: string, rawTags?: string): Promise<void> {
  p.intro("Econome follower");

  // Replication tags: which tagged collections this follower subscribes to,
  // on top of the untagged base pinset. Undefined = operator defaults.
  let tags: string[] | undefined;
  if (rawTags !== undefined) {
    const parsed = parseTagsInput(rawTags);
    if (parsed === null) {
      p.cancel(
        "Invalid --tags: use comma-separated lowercase slugs (e.g. photos,videos).",
      );
      process.exitCode = 1;
      return;
    }
    tags = parsed;
  }

  // 1. Resolve the join URL (prompt if not given).
  let joinUrl = url;
  if (!joinUrl) {
    const answer = await p.text({
      message: "Paste the join URL from the dashboard",
      placeholder: "https://your-dashboard/join/onb_…",
    });
    if (p.isCancel(answer)) {
      p.cancel("Cancelled.");
      return;
    }
    joinUrl = answer;
  }

  let origin: string;
  let token: string;
  try {
    ({ origin, token } = parseJoinUrl(joinUrl));
  } catch (err) {
    p.cancel(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  // 2. Preconditions.
  const dockerSpin = p.spinner();
  dockerSpin.start("Checking Docker");
  if (!(await dockerAvailable())) {
    dockerSpin.stop("Docker not found");
    p.cancel(
      "Docker Compose is required. Install it: https://docs.docker.com/get-docker/",
    );
    process.exitCode = 1;
    return;
  }
  dockerSpin.stop("Docker is ready");

  if (existsSync(pathJoin(homedir(), "econome-follower"))) {
    p.log.warn(
      "A bash-installed follower may already exist at ~/econome-follower. This CLI uses ~/.econome instead.",
    );
  }

  // 3. Fetch the rendered follower config.
  const cfgSpin = p.spinner();
  cfgSpin.start("Fetching cluster config");
  let config: Awaited<ReturnType<typeof fetchFollowerConfig>>;
  try {
    config = await fetchFollowerConfig(joinUrl);
  } catch (err) {
    cfgSpin.stop("Could not fetch config");
    p.cancel(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }
  cfgSpin.stop(`Joining "${config.clusterName}"`);

  // 4. Write the project + start the follower.
  const dir = projectDir();
  await writeProject(dir, config, {
    server: origin,
    token,
    clusterName: config.clusterName,
  });

  const upSpin = p.spinner();
  upSpin.start("Starting follower (docker compose up)");
  try {
    await composeUp(dir);
  } catch (err) {
    upSpin.stop("Failed to start");
    p.cancel(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }
  upSpin.stop("Follower started");

  // 5. Wait for the cluster peer id, then register it (best-effort).
  const idSpin = p.spinner();
  idSpin.start("Waiting for the cluster peer to come online");
  const peerId = await pollPeerId(() =>
    composeExec(dir, "cluster", ["ipfs-cluster-ctl", "--enc=json", "id"]),
  );
  if (!peerId) {
    idSpin.stop("Peer not online yet");
    p.log.warn(
      "The follower is running but hasn't reported a peer id yet. Check `econome logs`.",
    );
    p.outro(
      `Replicating "${config.clusterName}". Manage with: econome status | logs | stop`,
    );
    return;
  }
  idSpin.stop(`Peer online: ${peerId}`);

  const regSpin = p.spinner();
  regSpin.start("Registering with the dashboard");
  try {
    await registerPeer(origin, token, peerId, tags);
    regSpin.stop(
      tags && tags.length > 0
        ? `Registered (tags: ${tags.join(", ")})`
        : "Registered",
    );
  } catch {
    regSpin.stop("Could not register (the follower is still running)");
    p.log.warn("Registration failed; re-run `econome join` later to retry.");
  }

  p.outro(
    `Replicating "${config.clusterName}". Manage with: econome status | logs | stop`,
  );
}
