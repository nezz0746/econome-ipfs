import { getDb, uploads } from "@repo/db";
import { desc } from "drizzle-orm";
import { ExternalLink } from "lucide-react";

import { CopyButton } from "@/components/copy-button";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

const GATEWAY_URL = process.env.IPFS_GATEWAY_URL ?? "http://localhost:8081";

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default async function FilesPage() {
  const files = await getDb()
    .select({
      id: uploads.id,
      cid: uploads.cid,
      name: uploads.name,
      size: uploads.size,
      createdAt: uploads.createdAt,
    })
    .from(uploads)
    .orderBy(desc(uploads.createdAt));

  return (
    <>
      <PageHeader
        title="Files"
        description="Content ingested into the cluster. Each file is pinned across the peers."
      />

      <Card>
        <CardContent>
          {files.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No files yet. Upload one from the Test Upload page or via the
              ingest API.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>CID</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((file) => (
                  <TableRow key={file.id}>
                    <TableCell className="font-medium">
                      {file.name || "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <code className="max-w-55 truncate font-mono text-xs">
                          {file.cid}
                        </code>
                        <CopyButton value={file.cid} label="CID copied" />
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatBytes(file.size)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {file.createdAt.toISOString().slice(0, 10)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label="Open in gateway"
                        render={
                          <a
                            href={`${GATEWAY_URL}/ipfs/${file.cid}`}
                            target="_blank"
                            rel="noreferrer"
                          />
                        }
                      >
                        <ExternalLink className="size-3.5" />
                      </Button>
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
