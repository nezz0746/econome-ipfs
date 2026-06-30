import * as p from "@clack/prompts";
import { composeDown } from "../lib/docker.js";
import { projectDir, readProjectConfig } from "../lib/project.js";

export async function stop(): Promise<void> {
  const dir = projectDir();
  if (!(await readProjectConfig(dir))) {
    p.log.error("No follower set up. Run `econome join <url>` first.");
    process.exitCode = 1;
    return;
  }
  const s = p.spinner();
  s.start("Stopping follower");
  await composeDown(dir);
  s.stop(
    "Stopped (data kept). Re-start with `econome update` or `econome join`.",
  );
}
