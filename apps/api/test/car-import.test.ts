import { describe, expect, it, vi } from "vitest";

import { importCidFromGateway } from "../src/car-import";

function mockFetch(
  handler: (url: string) => { status?: number; body: string },
) {
  return vi.fn(async (url: string | URL) => {
    const u = typeof url === "string" ? url : url.toString();
    const { status = 200, body } = handler(u);
    return new Response(body, { status });
  }) as unknown as typeof fetch;
}

const CID = "bafybeiexampleroot";
const DEPS = { gateway: "https://gw", ipfsApiUrl: "http://kubo:5001" };

describe("importCidFromGateway", () => {
  it("fetches the CAR, imports it, and succeeds when the root matches", async () => {
    const fetchImpl = mockFetch((u) => {
      if (u.includes("format=car")) return { body: "CARBYTES" };
      if (u.includes("/api/v0/dag/import"))
        return {
          body: `${JSON.stringify({
            Root: { Cid: { "/": CID }, PinErrorMsg: "" },
          })}\n${JSON.stringify({
            Stats: { BlockCount: 3, BlockBytesCount: 123 },
          })}`,
        };
      throw new Error(`unexpected ${u}`);
    });

    const r = await importCidFromGateway(CID, { ...DEPS, fetchImpl });

    expect(r).toMatchObject({ cid: CID, ok: true, blocks: 3, bytes: 123 });
    const calls = (
      fetchImpl as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes(`/ipfs/${CID}?format=car`))).toBe(true);
    expect(calls.some((u) => u.includes("/api/v0/dag/import"))).toBe(true);
  });

  it("fails with cid_mismatch when the imported root differs", async () => {
    const fetchImpl = mockFetch((u) => {
      if (u.includes("format=car")) return { body: "CARBYTES" };
      return { body: JSON.stringify({ Root: { Cid: { "/": "bafyOTHER" } } }) };
    });

    const r = await importCidFromGateway(CID, { ...DEPS, fetchImpl });

    expect(r.ok).toBe(false);
    expect(r.error).toContain("cid_mismatch");
  });

  it("fails when the gateway cannot serve the CID", async () => {
    const fetchImpl = mockFetch((u) =>
      u.includes("format=car")
        ? { status: 404, body: "not found" }
        : { body: "" },
    );

    const r = await importCidFromGateway(CID, { ...DEPS, fetchImpl });

    expect(r.ok).toBe(false);
    expect(r.error).toBe("gateway_404");
  });

  it("surfaces a kubo pin error", async () => {
    const fetchImpl = mockFetch((u) => {
      if (u.includes("format=car")) return { body: "CARBYTES" };
      return {
        body: JSON.stringify({
          Root: { Cid: { "/": CID }, PinErrorMsg: "boom" },
        }),
      };
    });

    const r = await importCidFromGateway(CID, { ...DEPS, fetchImpl });

    expect(r.ok).toBe(false);
    expect(r.error).toContain("pin_error");
  });

  it("treats a dag/import error as success when the DAG is actually local (recovered)", async () => {
    const fetchImpl = mockFetch((u) => {
      if (u.includes("format=car")) return { body: "CARBYTES" };
      if (u.includes("/api/v0/dag/import"))
        return { status: 500, body: "boom" };
      if (u.includes("/api/v0/dag/stat"))
        return { body: JSON.stringify({ Size: 4242 }) };
      throw new Error(`unexpected ${u}`);
    });

    const r = await importCidFromGateway(CID, { ...DEPS, fetchImpl });

    expect(r).toMatchObject({
      cid: CID,
      ok: true,
      recovered: true,
      bytes: 4242,
    });
  });

  it("reports failure when dag/import errors and the DAG is not local", async () => {
    const fetchImpl = mockFetch((u) => {
      if (u.includes("format=car")) return { body: "CARBYTES" };
      if (u.includes("/api/v0/dag/import"))
        return { status: 500, body: "boom" };
      if (u.includes("/api/v0/dag/stat"))
        return { status: 500, body: "missing" };
      throw new Error(`unexpected ${u}`);
    });

    const r = await importCidFromGateway(CID, { ...DEPS, fetchImpl });

    expect(r.ok).toBe(false);
    expect(r.error).toContain("import_500");
  });
});
