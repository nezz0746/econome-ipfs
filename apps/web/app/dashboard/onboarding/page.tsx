import { getDb, onboardingTokens } from "@repo/db";
import { desc } from "drizzle-orm";

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
import { createOnboardingToken } from "@/lib/actions";
import { buildFollowerBundle } from "@/lib/cluster-config";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const bundle = buildFollowerBundle();
  const tokens = await getDb()
    .select({
      id: onboardingTokens.id,
      label: onboardingTokens.label,
      token: onboardingTokens.token,
      usedByPeerId: onboardingTokens.usedByPeerId,
      createdAt: onboardingTokens.createdAt,
    })
    .from(onboardingTokens)
    .orderBy(desc(onboardingTokens.createdAt));

  return (
    <>
      <PageHeader
        title="Onboarding"
        description="Share this bundle with a vetted participant so they can join as a follower (Kubo + ipfs-cluster-follow)."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Follower bundle</CardTitle>
          <CardDescription>
            Values a participant needs to replicate the company pinset.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <BundleRow label="Cluster name" value={bundle.clusterName} />
            <BundleRow
              label="Cluster secret"
              value={
                bundle.secret || "(set CLUSTER_SECRET in the dashboard env)"
              }
            />
            <BundleRow
              label="Bootstrap multiaddr"
              value={
                bundle.bootstrapMultiaddr ||
                "(set CLUSTER_BOOTSTRAP in the dashboard env)"
              }
            />
          </dl>
          <div>
            <p className="mb-1 text-sm text-muted-foreground">
              One-line join command
            </p>
            <div className="rounded-md bg-muted px-3 py-2 font-mono text-sm break-all">
              {bundle.command}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mint an onboarding token</CardTitle>
          <CardDescription>
            Track which participant joined with which token.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createOnboardingToken} className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="label">Participant label</Label>
              <Input id="label" name="label" placeholder="e.g. partner-acme" />
            </div>
            <Button type="submit">Mint token</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          {tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No onboarding tokens yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((token) => (
                  <TableRow key={token.id}>
                    <TableCell className="font-medium">
                      {token.label ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {token.token}
                    </TableCell>
                    <TableCell>
                      {token.usedByPeerId ? (
                        <Badge variant="secondary">joined</Badge>
                      ) : (
                        <Badge variant="outline">pending</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {token.createdAt.toISOString().slice(0, 10)}
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

function BundleRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm break-all">{value}</dd>
    </>
  );
}
