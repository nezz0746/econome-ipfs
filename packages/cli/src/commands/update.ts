import * as p from "@clack/prompts";
import { composePull, composeUp } from "../lib/docker.js";
import { projectDir, readProjectConfig } from "../lib/project.js";

export async function update(): Promise<void> {
  const dir = projectDir();
  if (!(await readProjectConfig(dir))) {
    p.log.error("No follower set up. Run `econome join <url>` first.");
    process.exitCode = 1;
    return;
  }
  const s = p.spinner();
  s.start("Pulling newer images");
  await composePull(dir);
  s.message("Restarting");
  await composeUp(dir);
  s.stop("Updated and restarted.");
}
