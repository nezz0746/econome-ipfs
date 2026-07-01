import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getEnrichedPeers } from "@/lib/api";
import { formatBytes } from "@/lib/format";

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
  let peers: Awaited<ReturnType<typeof getEnrichedPeers>> = [];
  let error: string | null = null;
  try {
    peers = await getEnrichedPeers();
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
                  <TableRow key={peer.id}>
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
                      {peer.online ? (
                        <Badge variant="secondary">online</Badge>
                      ) : (
                        <Badge variant="destructive">down</Badge>
                      )}
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
