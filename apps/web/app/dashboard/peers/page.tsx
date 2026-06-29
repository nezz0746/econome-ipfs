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
import { getPeers } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function PeersPage() {
  let peers: Awaited<ReturnType<typeof getPeers>> = [];
  let error: string | null = null;
  try {
    peers = await getPeers();
  } catch (err) {
    error = err instanceof Error ? err.message : "Cluster unreachable";
  }

  return (
    <>
      <PageHeader
        title="Peers & Followers"
        description="Cluster peers and participant followers, with reachability status."
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
                  <TableHead>Peer name</TableHead>
                  <TableHead>Peer ID</TableHead>
                  <TableHead>IPFS ID</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {peers.map((peer) => (
                  <TableRow key={peer.id}>
                    <TableCell className="font-medium">
                      {peer.peername || "—"}
                    </TableCell>
                    <TableCell className="max-w-55 truncate font-mono text-xs">
                      {peer.id}
                    </TableCell>
                    <TableCell className="max-w-55 truncate font-mono text-xs">
                      {peer.ipfsId ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {peer.error ? (
                        <Badge variant="destructive">down</Badge>
                      ) : (
                        <Badge variant="secondary">online</Badge>
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
