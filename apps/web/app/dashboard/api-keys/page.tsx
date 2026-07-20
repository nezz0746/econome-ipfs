import { apiKeys, decryptSecret, getDb } from "@repo/db";
import { desc } from "drizzle-orm";

import { CopyButton } from "@/components/copy-button";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createApiKey, revokeApiKey } from "@/lib/actions";

export const dynamic = "force-dynamic";

const API_PUBLIC_URL = (
  process.env.API_PUBLIC_URL ?? "http://localhost:8080"
).replace(/\/$/, "");
const API_DOCS_URL = API_PUBLIC_URL ? `${API_PUBLIC_URL}/docs` : null;

export default async function ApiKeysPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const { created } = await searchParams;
  const rows = await getDb()
    .select({
      id: apiKeys.id,
      label: apiKeys.label,
      encryptedKey: apiKeys.encryptedKey,
      createdAt: apiKeys.createdAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .orderBy(desc(apiKeys.createdAt));

  const keys = rows.map((row) => ({
    ...row,
    key: decryptSecret(row.encryptedKey),
  }));

  return (
    <>
      <PageHeader
        title="API Keys"
        description="Machine credentials for the ingest endpoint. Keys are shown once."
      />

      {API_DOCS_URL ? (
        <p className="text-sm text-muted-foreground">
          Use these keys against the machine API —{" "}
          <a
            className="underline underline-offset-4"
            href={API_DOCS_URL}
            target="_blank"
            rel="noreferrer"
          >
            read the API docs
          </a>
          .
        </p>
      ) : null}

      {created && (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-base">
              New key — copy it now, it won&apos;t be shown again
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md bg-muted px-3 py-2 font-mono text-sm break-all">
              {created}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create a key</CardTitle>
          <CardDescription>
            Used by machine clients in the <code>x-api-key</code> header.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createApiKey} className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="label">Label</Label>
              <Input id="label" name="label" placeholder="e.g. ingest-worker" />
            </div>
            <Button type="submit">Create key</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          {keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No keys yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">{key.label}</TableCell>
                    <TableCell>
                      {key.key ? (
                        <div className="flex items-center gap-1">
                          <code className="max-w-55 truncate font-mono text-xs">
                            {key.key}
                          </code>
                          <CopyButton value={key.key} label="API key copied" />
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          unavailable
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {key.createdAt.toISOString().slice(0, 10)}
                    </TableCell>
                    <TableCell>
                      {key.revokedAt ? (
                        <Badge variant="destructive">revoked</Badge>
                      ) : (
                        <Badge variant="secondary">active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {!key.revokedAt && (
                        <form action={revokeApiKey}>
                          <input type="hidden" name="id" value={key.id} />
                          <Button type="submit" variant="outline" size="sm">
                            Revoke
                          </Button>
                        </form>
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
