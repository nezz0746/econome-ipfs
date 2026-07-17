import Link from "next/link";
import { PeerStatus } from "@/components/peer-status";
import { TagBadges } from "@/components/tag-badges";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EnrichedPeer } from "@/lib/api";
import { formatBytes } from "@/lib/format";

function flag(countryCode: string): string {
  if (countryCode.length !== 2) return "";
  return String.fromCodePoint(
    ...[...countryCode.toUpperCase()].map(
      (c) => 0x1f1e6 + c.charCodeAt(0) - 65,
    ),
  );
}

export function PeersTable({ peers }: { peers: EnrichedPeer[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Peer</TableHead>
          <TableHead>Location</TableHead>
          <TableHead>IP</TableHead>
          <TableHead>Tags</TableHead>
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
            <TableCell>
              <TagBadges tags={peer.subscribedTags} />
            </TableCell>
            <TableCell className="text-right">
              {formatBytes(peer.bytesHeld)}
            </TableCell>
            <TableCell className="text-right">{peer.fileCount}</TableCell>
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
  );
}
