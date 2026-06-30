import * as p from "@clack/prompts";
import { composeLogs } from "../lib/docker.js";
import { projectDir, readProjectConfig } from "../lib/project.js";

export async function logs(follow: boolean): Promise<void> {
  const dir = projectDir();
  if (!(await readProjectConfig(dir))) {
    p.log.error("No follower set up. Run `econome join <url>` first.");
    process.exitCode = 1;
    return;
  }
  await composeLogs(dir, follow);
}
