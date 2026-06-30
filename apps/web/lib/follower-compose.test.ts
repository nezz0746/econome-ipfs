import { describe, expect, it } from "vitest";
import {
  buildDockerJoinScript,
  buildFollowerComposeFiles,
  wantsJson,
} from "./follower-compose";

const bundle = {
  clusterName: "econome",
  secret: "deadbeef0123456789abcdef",
  bootstrapMultiaddr:
    "/dns4/host.example/tcp/9096/p2p/12D3KooWMainPeerIdExample",
  command: "ignored",
};

describe("buildFollowerComposeFiles", () => {
  it("wires the secret, bootstrap, and trusted peer into the compose", () => {
    const { composeYaml, kuboInitSh } = buildFollowerComposeFiles(bundle);
    expect(composeYaml).toContain('CLUSTER_SECRET: "deadbeef0123456789abcdef"');
    expect(composeYaml).toContain(
      'CLUSTER_PEERADDRESSES: "/dns4/host.example/tcp/9096/p2p/12D3KooWMainPeerIdExample"',
    );
    // Trust only the main peer (id parsed from the bootstrap multiaddr).
    expect(composeYaml).toContain(
      'CLUSTER_CRDT_TRUSTEDPEERS: "12D3KooWMainPeerIdExample"',
    );
    expect(composeYaml).toContain(
      "./kubo-init.sh:/container-init.d/001-config.sh:ro",
    );
    expect(kuboInitSh).toContain("Addresses.API /ip4/0.0.0.0/tcp/5001");
  });

  it("falls back to trusting all peers when no peer id is present", () => {
    const { composeYaml } = buildFollowerComposeFiles({
      ...bundle,
      bootstrapMultiaddr: "/dns4/host.example/tcp/9096",
    });
    expect(composeYaml).toContain('CLUSTER_CRDT_TRUSTEDPEERS: "*"');
  });
});

describe("buildDockerJoinScript", () => {
  it("embeds the rendered compose + kubo init via heredocs", () => {
    const script = buildDockerJoinScript(bundle);
    expect(script.startsWith("#!/usr/bin/env bash")).toBe(true);
    expect(script).toContain("cat > docker-compose.yml <<'COMPOSE_EOF'");
    expect(script).toContain('CLUSTER_SECRET: "deadbeef0123456789abcdef"');
    expect(script).toContain("cat > kubo-init.sh <<'KUBO_EOF'");
  });
});

describe("wantsJson", () => {
  it("is true only when the Accept header requests JSON", () => {
    expect(wantsJson("application/json")).toBe(true);
    expect(wantsJson("text/html, application/json;q=0.9")).toBe(true);
    expect(wantsJson("*/*")).toBe(false);
    expect(wantsJson(null)).toBe(false);
  });
});
