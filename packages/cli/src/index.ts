import { Command } from "commander";

const program = new Command();

program
  .name("econome")
  .description("Join and manage an Econome IPFS cluster follower.")
  .version("0.1.0");

program
  .command("join")
  .argument("[url]", "join URL from the dashboard onboarding page")
  .option(
    "-t, --tags <tags>",
    "comma-separated replication tags to subscribe to (e.g. photos,videos); " +
      "omit to use the defaults set by the operator",
  )
  .description("Start a follower that replicates the cluster pinset")
  .action(async (url: string | undefined, opts: { tags?: string }) => {
    const { join } = await import("./commands/join.js");
    await join(url, opts.tags);
  });

program
  .command("publish")
  .argument("<dir>", "directory to publish (usually a build output)")
  .option("-n, --name <name>", "folder name; defaults to the directory name")
  .option("-t, --tags <tags>", "comma-separated replication tags")
  .option("--dry-run", "list what would be uploaded, upload nothing")
  .option("-y, --yes", "skip the confirmation prompt")
  .option("--api-url <url>", "override the API origin")
  .option("--gateway-url <url>", "override the gateway used for printed URLs")
  .description("Publish a directory to IPFS and print its gateway URL")
  .action(async (dir: string, opts) => {
    const { publish } = await import("./commands/publish.js");
    await publish(dir, opts);
  });

const auth = program
  .command("auth")
  .description("Store, inspect and remove the API key used by publish");

auth
  .command("login", { isDefault: true })
  .option("--api-url <url>", "override the API origin")
  .option("--no-verify", "store the key without checking it against the API")
  .description("Prompt for an API key and store it")
  .action(async (opts) => {
    const { login } = await import("./commands/auth.js");
    await login(opts);
  });

auth
  .command("status")
  .description("Show whether a key is configured, and where it comes from")
  .action(async () => {
    const { status } = await import("./commands/auth.js");
    await status();
  });

auth
  .command("logout")
  .description("Remove the stored API key")
  .action(async () => {
    const { logout } = await import("./commands/auth.js");
    await logout();
  });

program
  .command("status")
  .description("Show whether the follower is running and replicating")
  .action(async () => {
    const { status } = await import("./commands/status.js");
    await status();
  });

program
  .command("logs")
  .option("-f, --follow", "follow log output")
  .description("Show follower logs")
  .action(async (opts: { follow?: boolean }) => {
    const { logs } = await import("./commands/logs.js");
    await logs(Boolean(opts.follow));
  });

program
  .command("stop")
  .description("Stop the follower (keeps data)")
  .action(async () => {
    const { stop } = await import("./commands/stop.js");
    await stop();
  });

program
  .command("update")
  .description("Pull newer images and restart the follower")
  .action(async () => {
    const { update } = await import("./commands/update.js");
    await update();
  });

program.parseAsync();
