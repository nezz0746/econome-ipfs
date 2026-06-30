import { spawn } from "node:child_process";

/** Run a command, capturing stdout. Rejects on non-zero exit. */
function run(cmd: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `${cmd} exited with code ${code}`));
    });
  });
}

/** Run a command inheriting the parent's stdio (for live logs). */
function runInherit(cmd: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", () => resolve());
  });
}

/** True if `docker compose` is usable on this machine. */
export async function dockerAvailable(): Promise<boolean> {
  try {
    await run("docker", ["compose", "version"]);
    return true;
  } catch {
    return false;
  }
}

export async function composeUp(dir: string): Promise<void> {
  await run("docker", ["compose", "up", "-d"], dir);
}

export async function composeDown(dir: string): Promise<void> {
  await run("docker", ["compose", "down"], dir);
}

export async function composePull(dir: string): Promise<void> {
  await run("docker", ["compose", "pull"], dir);
}

export async function composeExec(
  dir: string,
  service: string,
  cmd: string[],
): Promise<string> {
  return run("docker", ["compose", "exec", "-T", service, ...cmd], dir);
}

export async function composeLogs(dir: string, follow: boolean): Promise<void> {
  const args = ["compose", "logs"];
  if (follow) args.push("-f");
  await runInherit("docker", args, dir);
}
