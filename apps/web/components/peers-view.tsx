"use client";

import { List, Map as MapIcon } from "lucide-react";
import { PeersMap } from "@/components/peers-map";
import { PeersTable } from "@/components/peers-table";
import { RefreshLocationsButton } from "@/components/refresh-locations-button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsPanel, TabsTrigger } from "@/components/ui/tabs";
import type { EnrichedPeer } from "@/lib/api";
import { timeAgo } from "@/lib/format";

export function PeersView({
  peers,
  locationsUpdatedAt,
  error,
}: {
  peers: EnrichedPeer[];
  locationsUpdatedAt: string | null;
  error: string | null;
}) {
  return (
    <Card>
      <CardContent>
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {locationsUpdatedAt
              ? `Locations updated ${timeAgo(new Date(locationsUpdatedAt))}`
              : "Locations not yet resolved"}
          </p>
          <RefreshLocationsButton />
        </div>
        {error ? (
          <p className="font-mono text-sm text-destructive">{error}</p>
        ) : peers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No peers reported yet.
          </p>
        ) : (
          <Tabs defaultValue="list">
            <TabsList>
              <TabsTrigger value="list">
                <List />
                List
              </TabsTrigger>
              <TabsTrigger value="map">
                <MapIcon />
                Map
              </TabsTrigger>
            </TabsList>
            <TabsPanel value="list">
              <PeersTable peers={peers} />
            </TabsPanel>
            <TabsPanel value="map">
              <PeersMap peers={peers} />
            </TabsPanel>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
