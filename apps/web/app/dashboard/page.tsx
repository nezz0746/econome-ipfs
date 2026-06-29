import { AlertTriangle, Database, Network, Wifi } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getOverview } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  let overview: Awaited<ReturnType<typeof getOverview>> | null = null;
  let error: string | null = null;
  try {
    overview = await getOverview();
  } catch (err) {
    error = err instanceof Error ? err.message : "Cluster unreachable";
  }

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
