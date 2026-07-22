import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readProjectConfig,
  readPublishCredentials,
  writeProject,
  writePublishCredentials,
} from "./project";

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

describe("publish credentials", () => {
  it("reads back what --save-key wrote", async () => {
    const dir = await mkdtemp(join(tmpdir(), "econome-creds-"));
    await writePublishCredentials(dir, { apiKey: "eco_saved" });
    expect(await readPublishCredentials(dir)).toEqual({ apiKey: "eco_saved" });
  });

  it("writes the file 0600, since it holds a credential", async () => {
    const dir = await mkdtemp(join(tmpdir(), "econome-creds-"));
    const path = await writePublishCredentials(dir, { apiKey: "k" });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("returns null when nothing has been saved", async () => {
    const dir = await mkdtemp(join(tmpdir(), "econome-creds-"));
    expect(await readPublishCredentials(dir)).toBeNull();
  });

  it("keeps the credentials out of the follower config that join overwrites", async () => {
    const dir = await mkdtemp(join(tmpdir(), "econome-creds-"));
    await writePublishCredentials(dir, { apiKey: "k" });
    expect(existsSync(join(dir, "config.json"))).toBe(false);
  });
});
