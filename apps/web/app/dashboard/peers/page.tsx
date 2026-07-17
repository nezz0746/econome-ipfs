import { PageHeader } from "@/components/page-header";
import { PeersView } from "@/components/peers-view";
import { type EnrichedPeersResult, getEnrichedPeers } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function PeersPage() {
  let peers: EnrichedPeersResult["peers"] = [];
  let locationsUpdatedAt: string | null = null;
  let error: string | null = null;
  try {
    const result = await getEnrichedPeers();
    peers = result.peers;
    locationsUpdatedAt = result.locationsUpdatedAt;
  } catch (err) {
    error = err instanceof Error ? err.message : "Cluster unreachable";
  }

  return (
    <>
      <PageHeader
        title="Peers & Followers"
        description="Cluster peers and participant followers — location, data held, and reachability."
      />
      <PeersView
        peers={peers}
        locationsUpdatedAt={locationsUpdatedAt}
        error={error}
      />
    </>
  );
}
