import { AlertTriangle, Database, Network, Wifi } from "lucide-react";

import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getOverview, getPinProgress, type PinProgress } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  let overview: Awaited<ReturnType<typeof getOverview>> | null = null;
  let progress: PinProgress | null = null;
  let error: string | null = null;
  try {
    [overview, progress] = await Promise.all([getOverview(), getPinProgress()]);
  } catch (err) {
    error = err instanceof Error ? err.message : "Cluster unreachable";
  }

  const inFlight = progress ? progress.pinning + progress.queued : 0;

  const stats = [
    { label: "Peers", value: overview?.peerCount ?? 0, icon: Network },
    { label: "Online", value: overview?.onlinePeers ?? 0, icon: Wifi },
    { label: "Pinned CIDs", value: overview?.totalPins ?? 0, icon: Database },
    {
      label: "Under-replicated",
      value: overview?.underReplicated ?? 0,
      icon: AlertTriangle,
    },
  ];

  return (
    <>
      <PageHeader
        title="Overview"
        description="Live state of the Econome collaborative cluster."
      />

      {/* Keep progress live while a migration/pin is in flight. */}
      {inFlight > 0 ? <AutoRefresh seconds={8} /> : null}

      {progress && progress.total > 0 ? (
        <Card className="mb-4">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {inFlight > 0 ? "Pinning in progress" : "Pinset"}
            </CardTitle>
            <span className="text-sm text-muted-foreground tabular-nums">
              {progress.pinned.toLocaleString()} /{" "}
              {progress.total.toLocaleString()} pinned
            </span>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{
                  width: `${
                    progress.total > 0
                      ? Math.round((progress.pinned / progress.total) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
              <span>✓ {progress.pinned.toLocaleString()} pinned</span>
              {progress.pinning > 0 ? (
                <span>⟳ {progress.pinning.toLocaleString()} pinning</span>
              ) : null}
              {progress.queued > 0 ? (
                <span>… {progress.queued.toLocaleString()} queued</span>
              ) : null}
              {progress.error > 0 ? (
                <span className="text-destructive">
                  ✕ {progress.error.toLocaleString()} error
                </span>
              ) : null}
              {inFlight > 0 ? (
                <span className="text-primary">live · updates every 8s</span>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">
              Could not reach the cluster API
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <Card key={stat.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.label}
                </CardTitle>
                <stat.icon className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stat.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
