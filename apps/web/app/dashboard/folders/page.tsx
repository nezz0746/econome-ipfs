import Link from "next/link";

import { CreateFolderForm } from "@/components/create-folder-form";
import { PageHeader } from "@/components/page-header";
import { SortableHeader } from "@/components/sortable-header";
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
import { deleteFolderAction } from "@/lib/actions";
import { getFolders } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import {
  type FolderSortKey,
  nextDir,
  parseSort,
  type Sort,
  type SortDir,
  sortFolders,
} from "@/lib/table-sort";

const GATEWAY_URL = process.env.IPFS_GATEWAY_URL ?? "http://localhost:8081";

export const dynamic = "force-dynamic";

const FOLDER_SORT_KEYS: readonly FolderSortKey[] = ["name", "size"] as const;
/** Alphabetical by default — MFS listing order is not guaranteed. */
const DEFAULT_FOLDER_SORT: Sort<FolderSortKey> = { key: "name", dir: "asc" };

function foldersHref(sort: Sort<FolderSortKey>): string {
  if (
    sort.key === DEFAULT_FOLDER_SORT.key &&
    sort.dir === DEFAULT_FOLDER_SORT.dir
  ) {
    return "/dashboard/folders";
  }
  return `/dashboard/folders?sort=${sort.key}&dir=${sort.dir}`;
}

export default async function FoldersPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string | string[]; dir?: string | string[] }>;
}) {
  const params = await searchParams;
  const sort = parseSort(params, FOLDER_SORT_KEYS, DEFAULT_FOLDER_SORT);
  const folders = sortFolders(await getFolders(), sort);

  const sortHref = (key: FolderSortKey, defaultDir: SortDir) =>
    foldersHref({ key, dir: nextDir(sort, key, defaultDir) });

  return (
    <>
      <PageHeader
        title="Folders"
        description="Mutable IPFS directories: each folder replicates as one unit (tags decide to which participants) and keeps a permanent /ipns/ URL pointing at its latest version."
      />

      <Card>
        <CardContent className="pt-6">
          <CreateFolderForm />
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          {folders.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No folders yet — create one above.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHeader
                    label="Name"
                    href={sortHref("name", "asc")}
                    active={sort.key === "name"}
                    dir={sort.dir}
                  />
                  <TableHead>Tags</TableHead>
                  <SortableHeader
                    label="Size"
                    href={sortHref("size", "desc")}
                    active={sort.key === "size"}
                    dir={sort.dir}
                  />
                  <TableHead>Links</TableHead>
                  <TableHead className="text-right">Delete</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {folders.map((f) => (
                  <TableRow key={f.name}>
                    <TableCell>
                      <Link
                        className="font-medium underline-offset-4 hover:underline"
                        href={`/dashboard/folders/${encodeURIComponent(f.name)}`}
                      >
                        {f.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <TagBadges tags={f.tags} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatBytes(f.size)}
                    </TableCell>
                    <TableCell className="space-x-3 font-mono text-xs">
                      <a
                        className="underline-offset-4 hover:underline"
                        href={`${GATEWAY_URL}/ipfs/${f.rootCid}/`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        /ipfs (this version)
                      </a>
                      {f.ipnsName && (
                        <a
                          className="underline-offset-4 hover:underline"
                          href={`${GATEWAY_URL}/ipns/${f.ipnsName}/`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          /ipns (latest)
                        </a>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <form action={deleteFolderAction}>
                        <input type="hidden" name="name" value={f.name} />
                        <Button variant="destructive" size="sm" type="submit">
                          Delete
                        </Button>
                      </form>
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
