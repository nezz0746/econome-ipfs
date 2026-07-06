import { describe, expect, it, vi } from "vitest";
import { parsePeerId, parsePinCount, pollPeerId } from "./peer";

describe("parsePeerId", () => {
  it("reads the id field from cluster-ctl JSON", () => {
    expect(parsePeerId('{"id":"12D3KooWAbc","version":"1.0"}')).toBe(
      "12D3KooWAbc",
    );
  });

  it("returns null on empty or unparseable output", () => {
    expect(parsePeerId("")).toBeNull();
    expect(parsePeerId("connection refused")).toBeNull();
  });
});

describe("pollPeerId", () => {
  it("retries until an id appears", async () => {
    const getStdout = vi
      .fn()
      .mockResolvedValueOnce("") // daemon not ready
      .mockRejectedValueOnce(new Error("exec failed")) // container starting
      .mockResolvedValueOnce('{"id":"12D3KooWReady"}');
    const id = await pollPeerId(getStdout, { attempts: 5, delayMs: 0 });
    expect(id).toBe("12D3KooWReady");
    expect(getStdout).toHaveBeenCalledTimes(3);
  });

  it("returns null after exhausting attempts", async () => {
    const getStdout = vi.fn().mockResolvedValue("");
    const id = await pollPeerId(getStdout, { attempts: 3, delayMs: 0 });
    expect(id).toBeNull();
    expect(getStdout).toHaveBeenCalledTimes(3);
  });
});

// One GlobalPinInfo object, pretty-printed the way `ipfs-cluster-ctl
// --enc=json status` prints it (4-space indent, nested peer_map, arrays).
function pinObject(cid: string): string {
  return JSON.stringify(
    {
      cid,
      name: "",
      allocations: [],
      origins: [],
      created: "2026-07-01T22:40:14Z",
      metadata: null,
      peer_map: {
        "12D3KooWAJjy1pMXMy9Mohxs1UdnAR2sPgBCFXfR1FwrMpa19DvF": {
          peername: "fb36339d83e8",
          ipfs_peer_id: "12D3KooWPF8HFEfPGwy2kaHkCL9Ek5eiXWaFNJRiVVb6CSqwaEZm",
          ipfs_peer_addresses: ["/dns4/example.libp2p.direct/tcp/4001/tls/ws"],
          status: "pinned",
          timestamp: "2026-07-01T22:40:14Z",
          error: "",
        },
      },
    },
    null,
    4,
  );
}

describe("parsePinCount", () => {
  it("counts concatenated pretty-printed objects (real cluster-ctl format)", () => {
    // cluster-ctl does NOT emit a JSON array — it prints one pretty-printed
    // object per CID, back to back. This is the shape that regressed the count
    // to 0 (JSON.parse of the whole blob throws on the second object).
    const stream = [pinObject("Qm1"), pinObject("Qm2"), pinObject("Qm3")].join(
      "\n",
    );
    expect(parsePinCount(stream)).toBe(3);
  });

  it("counts newline-delimited objects", () => {
    expect(parsePinCount('{"cid":"Qm1"}\n{"cid":"Qm2"}')).toBe(2);
  });

  it("counts a single object as one pin", () => {
    expect(parsePinCount(pinObject("Qm1"))).toBe(1);
  });

  it("counts a JSON array (defensive: other cluster-ctl versions)", () => {
    expect(parsePinCount('[{"cid":"Qm1"},{"cid":"Qm2"}]')).toBe(2);
  });

  it("ignores braces and quotes inside string values", () => {
    const weird = JSON.stringify({ cid: "Qm1", name: 'a{b}c "x" \\ end' });
    expect(parsePinCount(`${weird}\n${weird}`)).toBe(2);
  });

  it("returns 0 for an empty pinset", () => {
    expect(parsePinCount("[]")).toBe(0);
    expect(parsePinCount("")).toBe(0);
    expect(parsePinCount("   \n  ")).toBe(0);
  });

  it("returns 0 for unparseable non-object output", () => {
    expect(parsePinCount("connection refused")).toBe(0);
  });
});
