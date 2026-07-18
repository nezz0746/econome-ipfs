"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PeerFile } from "@/lib/api";
import { formatBytes } from "@/lib/format";

const PAGE_SIZES = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

/**
 * Files a peer holds, paginated client-side: the full list arrives with the
 * peer detail payload, so page flips are instant (no refetch).
 */
export function PeerFilesTable({ files }: { files: PeerFile[] }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  const total = files.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clamped = Math.min(page, totalPages);
  const offset = (clamped - 1) * pageSize;
  const rows = files.slice(offset, offset + pageSize);

  return (
    <>
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
          {rows.map((f) => (
            <TableRow key={f.cid}>
              <TableCell className="font-medium">{f.name || "—"}</TableCell>
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
                  variant={f.status === "pinned" ? "secondary" : "outline"}
                >
                  {f.status}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Rows per page</span>
          <div className="flex items-center gap-1">
            {PAGE_SIZES.map((size) => (
              <Button
                key={size}
                variant={size === pageSize ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2 tabular-nums"
                onClick={() => {
                  setPageSize(size);
                  setPage(1);
                }}
              >
                {size}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="tabular-nums">
            {total === 0 ? 0 : offset + 1}–{offset + rows.length} of {total}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={clamped <= 1}
              onClick={() => setPage(clamped - 1)}
            >
              Previous
            </Button>
            <span className="px-1 tabular-nums">
              {clamped} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={clamped >= totalPages}
              onClick={() => setPage(clamped + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
