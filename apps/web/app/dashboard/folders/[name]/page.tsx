import Link from "next/link";
import { notFound } from "next/navigation";

import { FolderAddControls } from "@/components/folder-add-controls";
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
import { deleteFolderEntryAction } from "@/lib/actions";
import { getFolder } from "@/lib/api";
import { formatBytes } from "@/lib/format";

const GATEWAY_URL = process.env.IPFS_GATEWAY_URL ?? "http://localhost:8081";

export const dynamic = "force-dynamic";

export default async function FolderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ path?: string }>;
}) {
  const { name } = await params;
  const { path = "" } = await searchParams;
  const folder = await getFolder(decodeURIComponent(name), path);
  if (!folder) notFound();

  const crumbs = path ? path.split("/") : [];
  const base = `/dashboard/folders/${encodeURIComponent(folder.name)}`;

  return (
    <>
      <PageHeader
        title={folder.name}
        description={`Latest root ${folder.rootCid} — every change re-pins a new root and updates the /ipns/ pointer.`}
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <TagBadges tags={folder.tags} />
        <span className="text-muted-foreground">
          {formatBytes(folder.size)}
        </span>
        <a
          className="font-mono text-xs underline-offset-4 hover:underline"
          href={`${GATEWAY_URL}/ipfs/${folder.rootCid}/`}
          target="_blank"
          rel="noreferrer"
        >
          /ipfs (this version)
        </a>
        {folder.ipnsName && (
          <a
            className="font-mono text-xs underline-offset-4 hover:underline"
            href={`${GATEWAY_URL}/ipns/${folder.ipnsName}/`}
            target="_blank"
            rel="noreferrer"
          >
            /ipns (latest)
          </a>
        )}
      </div>

      <nav className="text-sm text-muted-foreground">
        <Link className="hover:underline" href={base}>
          {folder.name}
        </Link>
        {crumbs.map((seg, i) => {
          const sub = crumbs.slice(0, i + 1).join("/");
          return (
            <span key={sub}>
              {" / "}
              <Link
                className="hover:underline"
                href={`${base}?path=${encodeURIComponent(sub)}`}
              >
                {seg}
              </Link>
            </span>
          );
        })}
      </nav>

      <FolderAddControls
        folderName={folder.name}
        currentPath={path}
        existingNames={folder.entries.map((e) => e.name)}
      />

      <Card>
        <CardContent>
          {folder.entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Empty.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>CID</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="text-right">Remove</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {folder.entries.map((entry) => {
                  const entryPath = path ? `${path}/${entry.name}` : entry.name;
                  const entryHref = `${GATEWAY_URL}/ipfs/${folder.rootCid}/${entryPath
                    .split("/")
                    .map(encodeURIComponent)
                    .join("/")}`;
                  return (
                    <TableRow key={entry.name}>
                      <TableCell className="font-medium">
                        {entry.type === "dir" ? (
                          <Link
                            className="underline-offset-4 hover:underline"
                            href={`${base}?path=${encodeURIComponent(entryPath)}`}
                          >
                            {entry.name}/
                          </Link>
                        ) : (
                          <a
                            className="underline-offset-4 hover:underline"
                            href={entryHref}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {entry.name}
                          </a>
                        )}
                      </TableCell>
                      <TableCell>
                        <code className="max-w-55 truncate font-mono text-xs">
                          {entry.cid}
                        </code>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatBytes(entry.size)}
                      </TableCell>
                      <TableCell className="text-right">
                        <form action={deleteFolderEntryAction}>
                          <input
                            type="hidden"
                            name="name"
                            value={folder.name}
                          />
                          <input type="hidden" name="path" value={entryPath} />
                          <Button variant="ghost" size="sm" type="submit">
                            Remove
                          </Button>
                        </form>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
