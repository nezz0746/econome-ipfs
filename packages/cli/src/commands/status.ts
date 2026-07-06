import * as p from "@clack/prompts";
import { composeExec } from "../lib/docker.js";
import { parsePeerId, parsePinCount } from "../lib/peer.js";
import { projectDir, readProjectConfig } from "../lib/project.js";

export async function status(): Promise<void> {
  const dir = projectDir();
  const cfg = await readProjectConfig(dir);
  if (!cfg) {
    p.log.error("No follower set up. Run `econome join <url>` first.");
    process.exitCode = 1;
    return;
  }

  p.intro(`Econome follower — ${cfg.clusterName}`);
  try {
    const idOut = await composeExec(dir, "cluster", [
      "ipfs-cluster-ctl",
      "--enc=json",
      "id",
    ]);
    const peerId = parsePeerId(idOut);
    if (peerId) p.log.success(`Online — peer ${peerId}`);
    else p.log.warn("Cluster container is up but not reporting an id yet.");

    const pins = await composeExec(dir, "cluster", [
      "ipfs-cluster-ctl",
      "--enc=json",
      "status",
    ]);
    p.log.info(`Tracked pins: ${parsePinCount(pins)}`);
  } catch (err) {
    p.log.error(
      `Follower not reachable: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  }
  p.outro("Done");
}
