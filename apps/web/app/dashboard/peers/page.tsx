import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { PeerStatus } from "@/components/peer-status";
import { RefreshLocationsButton } from "@/components/refresh-locations-button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type EnrichedPeersResult, getEnrichedPeers } from "@/lib/api";
import { formatBytes, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

function flag(countryCode: string): string {
  if (countryCode.length !== 2) return "";
  return String.fromCodePoint(
    ...[...countryCode.toUpperCase()].map(
      (c) => 0x1f1e6 + c.charCodeAt(0) - 65,
    ),
  );
}

export default async function PeersPage() {
  let peers: EnrichedPeersResult["peers"] = [];
  let locationsUpdatedAt: string | null = null;
  let error: string | null = null;
  try {
    const result = await getEnrichedPeers();
    peers = result.peers;
    locationsUpdatedAt = result.locationsUpdatedAt;
  } catch (err) {
    error = err instanceof Error ? err.message : "Cluster unreachable";
  }

  return (
    <>
      <PageHeader
        title="Peers & Followers"
        description="Cluster peers and participant followers — location, data held, and reachability."
      />
      <Card>
        <CardContent>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {locationsUpdatedAt
                ? `Locations updated ${timeAgo(new Date(locationsUpdatedAt))}`
                : "Locations not yet resolved"}
            </p>
            <RefreshLocationsButton />
          </div>
          {error ? (
            <p className="font-mono text-sm text-destructive">{error}</p>
          ) : peers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No peers reported yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Peer</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead className="text-right">Data held</TableHead>
                  <TableHead className="text-right">Files</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {peers.map((peer) => (
                  <TableRow
                    key={peer.id}
                    className={peer.online ? undefined : "opacity-60"}
                  >
                    <TableCell className="font-medium">
                      <Link
                        href={`/dashboard/peers/${encodeURIComponent(peer.id)}`}
                        className="hover:underline"
                      >
                        {peer.peername || peer.id.slice(0, 12)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {peer.geo
                        ? `${flag(peer.geo.countryCode)} ${peer.geo.city || peer.geo.country}`
                        : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {peer.publicIp ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatBytes(peer.bytesHeld)}
                    </TableCell>
                    <TableCell className="text-right">
                      {peer.fileCount}
                    </TableCell>
                    <TableCell className="text-right">
                      <PeerStatus
                        online={peer.online}
                        onlineSince={peer.onlineSince}
                        lastSeenAt={peer.lastSeenAt}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
