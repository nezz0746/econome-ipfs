"use client";

import { RefreshCw } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { refreshPeerLocations } from "@/lib/actions";

/**
 * Triggers a forced geo re-lookup for all peers. The server action revalidates
 * the Peers page, so the refreshed locations render when the transition ends.
 */
export function RefreshLocationsButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            await refreshPeerLocations();
            toast.success("Locations refreshed");
          } catch {
            toast.error("Could not refresh locations");
          }
        })
      }
    >
      <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} />
      {pending ? "Refreshing…" : "Refresh locations"}
    </Button>
  );
}
