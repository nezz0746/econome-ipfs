import { notFound } from "next/navigation";
import { ContributionChart } from "@/components/contribution-chart";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getPeerDetail } from "@/lib/api";
import { formatBytes } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PeerDetailPage({
  params,
}: {
  params: Promise<{ peerId: string }>;
}) {
  const { peerId } = await params;
  const peer = await getPeerDetail(peerId);
  if (!peer) notFound();

  return (
    <>
      <PageHeader
        title={peer.peername || peer.id.slice(0, 16)}
        description={
          peer.online
            ? "Online — replicating the company pinset."
            : "Currently unreachable."
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Identity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Peer ID" value={peer.id} mono />
            <Row label="IPFS ID" value={peer.ipfsId ?? "—"} mono />
            <Row label="Version" value={peer.version ?? "—"} />
            <Row label="Status" value={peer.online ? "online" : "down"} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Location & data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Public IP" value={peer.publicIp ?? "—"} mono />
            <Row
              label="Location"
              value={
                peer.geo
                  ? `${peer.geo.city || "—"}, ${peer.geo.country} (${peer.geo.countryCode})`
                  : "—"
              }
            />
            <Row label="Data held" value={formatBytes(peer.bytesHeld)} />
            <Row label="Files" value={String(peer.fileCount)} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contribution over time</CardTitle>
        </CardHeader>
        <CardContent>
          <ContributionChart points={peer.snapshots} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Files synced ({peer.files.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {peer.files.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No files allocated to this peer yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>CID</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead>Synced</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {peer.files.map((f) => (
                  <TableRow key={f.cid}>
                    <TableCell className="font-medium">
                      {f.name || "—"}
                    </TableCell>
                    <TableCell className="max-w-55 truncate font-mono text-xs">
                      {f.cid}
                    </TableCell>
                    <TableCell className="text-right">
                      {f.size != null ? formatBytes(f.size) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {f.syncedAt
                        ? new Date(f.syncedAt)
                            .toISOString()
                            .slice(0, 16)
                            .replace("T", " ")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant={
                          f.status === "pinned" ? "secondary" : "outline"
                        }
                      >
                        {f.status}
                      </Badge>
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

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "max-w-60 truncate font-mono text-xs" : ""}>
        {value}
      </span>
    </div>
  );
}
