/** Extract a peer's first public IP from its libp2p multiaddrs. */
export function extractPublicIp(addresses: string[]): string | null {
  const ip4: string[] = [];
  const ip6: string[] = [];
  for (const addr of addresses) {
    const parts = addr.split("/");
    const i4 = parts.indexOf("ip4");
    const v4 = i4 >= 0 ? parts[i4 + 1] : undefined;
    if (v4) ip4.push(v4);
    const i6 = parts.indexOf("ip6");
    const v6 = i6 >= 0 ? parts[i6 + 1] : undefined;
    if (v6) ip6.push(v6);
  }
  const publicV4 = ip4.find((ip) => !isPrivateV4(ip));
  if (publicV4) return publicV4;
  const publicV6 = ip6.find((ip) => !isPrivateV6(ip));
  return publicV6 ?? null;
}

function isPrivateV4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 169 && b === 254) return true; // link-local
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
  return false;
}
