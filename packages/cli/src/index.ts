import { Command } from "commander";

const program = new Command();

program
  .name("econome")
  .description("Join and manage an Econome IPFS cluster follower.")
  .version("0.1.0");

program
  .command("join")
  .argument("[url]", "join URL from the dashboard onboarding page")
  .description("Start a follower that replicates the cluster pinset")
  .action(async (url?: string) => {
    const { join } = await import("./commands/join.js");
    await join(url);
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
