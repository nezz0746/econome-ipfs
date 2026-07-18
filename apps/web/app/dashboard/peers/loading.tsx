import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Streamed instantly on navigation while the peers data (cluster + geo +
 * DB) resolves server-side — keeps the transition unblocked.
 */
export default function PeersLoading() {
  return (
    <>
      <PageHeader
        title="Peers & Followers"
        description="Cluster peers and participant followers — location, data held, and reachability."
      />
      <Card>
        <CardContent>
          <div className="mb-3 flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-8 w-36" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            {Array.from({ length: 6 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
