import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readProjectConfig, writeProject } from "./project";

describe("writeProject / readProjectConfig", () => {
  it("writes the compose, kubo init, and config files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "econome-test-"));
    await writeProject(
      dir,
      {
        clusterName: "econome",
        compose: "services: {}\n",
        kuboInit: "#!/bin/sh\n",
      },
      { server: "https://host", token: "onb_x", clusterName: "econome" },
    );

    expect(readFileSync(join(dir, "docker-compose.yml"), "utf8")).toContain(
      "services:",
    );
    expect(readFileSync(join(dir, "kubo-init.sh"), "utf8")).toContain(
      "#!/bin/sh",
    );

    const cfg = await readProjectConfig(dir);
    expect(cfg).toEqual({
      server: "https://host",
      token: "onb_x",
      clusterName: "econome",
    });
  });

  it("returns null when no config exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "econome-test-"));
    expect(await readProjectConfig(dir)).toBeNull();
  });
});
