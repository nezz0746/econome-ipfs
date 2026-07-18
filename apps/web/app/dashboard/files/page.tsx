import { apiKeys, getDb, uploads } from "@repo/db";
import { count, desc, eq, sql } from "drizzle-orm";
import { ExternalLink } from "lucide-react";

import { CopyButton } from "@/components/copy-button";
import { PageHeader } from "@/components/page-header";
import { TagBadges } from "@/components/tag-badges";
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
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

const GATEWAY_URL = process.env.IPFS_GATEWAY_URL ?? "http://localhost:8081";

const PAGE_SIZES = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Parse a positive integer search param, falling back to `fallback`. */
function toInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function pageHref(page: number, pageSize: number): string {
  return `/dashboard/files?page=${page}&pageSize=${pageSize}`;
}

/**
 * One page of uploads plus the unpaginated total, resolved in a single query
 * via `count(*) OVER ()`. The window count is evaluated over the full filtered
 * set, so it is only present when the page has at least one row.
 */
function selectPage(
  db: ReturnType<typeof getDb>,
  offset: number,
  limit: number,
) {
  return db
    .select({
      id: uploads.id,
      cid: uploads.cid,
      name: uploads.name,
      size: uploads.size,
      tags: uploads.tags,
      // The API key that ingested the file — its label identifies the origin
      // client (one key per client: CMS, app, migration script, …).
      source: apiKeys.label,
      createdAt: uploads.createdAt,
      total: sql<number>`count(*) over()`.mapWith(Number),
    })
    .from(uploads)
    .leftJoin(apiKeys, eq(uploads.apiKeyId, apiKeys.id))
    .orderBy(desc(uploads.createdAt))
    .limit(limit)
    .offset(offset);
}

export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string }>;
}) {
  const params = await searchParams;

  const requestedSize = toInt(params.pageSize, DEFAULT_PAGE_SIZE);
  const pageSize = PAGE_SIZES.includes(
    requestedSize as (typeof PAGE_SIZES)[number],
  )
    ? requestedSize
    : DEFAULT_PAGE_SIZE;

  const db = getDb();
  const requestedPage = toInt(params.page, 1);

  // Common path: fetch the requested page and its total in one round-trip.
  let files = await selectPage(db, (requestedPage - 1) * pageSize, pageSize);
  let total: number;
  let page: number;

  const firstFile = files[0];
  if (firstFile) {
    // The window count rides along on every row, so any row carries the total.
    total = firstFile.total;
    page = requestedPage;
  } else {
    // Empty page — either the table is empty or the requested page is past the
    // end. Resolve the true total, clamp to the last page, and fetch it. This
    // preserves the "out-of-range page shows the last page" behaviour.
    const [totalRow] = await db.select({ total: count() }).from(uploads);
    total = totalRow?.total ?? 0;
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    page = Math.min(requestedPage, lastPage);
    files =
      total === 0
        ? files
        : await selectPage(db, (page - 1) * pageSize, pageSize);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const offset = (page - 1) * pageSize;
  const firstRow = total === 0 ? 0 : offset + 1;
  const lastRow = offset + files.length;

  return (
    <>
      <PageHeader
        title="Files"
        description="Content ingested into the cluster. Each file is pinned to the main node and its tag subscribers."
      />

      <Card>
        <CardContent>
          {total === 0 ? (
            <p className="text-sm text-muted-foreground">
              No files yet. Upload one from the Test Upload page or via the
              ingest API.
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>CID</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Tags</TableHead>
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
                        {file.source ?? "—"}
                      </TableCell>
                      <TableCell>
                        <TagBadges tags={file.tags} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatBytes(file.size)}
                      </TableCell>
                      <TableCell
                        className="whitespace-nowrap text-muted-foreground"
                        title={file.createdAt.toISOString()}
                      >
                        {timeAgo(file.createdAt)}
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
                        render={<a href={pageHref(1, size)} />}
                      >
                        {size}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span className="tabular-nums">
                    {firstRow}–{lastRow} of {total}
                  </span>
                  <div className="flex items-center gap-1">
                    {page > 1 ? (
                      <Button
                        variant="outline"
                        size="sm"
                        render={<a href={pageHref(page - 1, pageSize)} />}
                      >
                        Previous
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" disabled>
                        Previous
                      </Button>
                    )}
                    <span className="px-1 tabular-nums">
                      {page} / {totalPages}
                    </span>
                    {page < totalPages ? (
                      <Button
                        variant="outline"
                        size="sm"
                        render={<a href={pageHref(page + 1, pageSize)} />}
                      >
                        Next
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" disabled>
                        Next
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
