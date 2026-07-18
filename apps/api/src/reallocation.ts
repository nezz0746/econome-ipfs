import type { ClusterClient } from "./cluster-client";
import { planReallocations, TAGS_META_KEY, type TagSubscription } from "./tags";

export interface ReallocationDeps {
  cluster: ClusterClient;
  /** Participants' tag subscriptions (from the participants table). */
  listTagSubscriptions: () => Promise<TagSubscription[]>;
}

/**
 * Converge tagged pins onto their desired allocations. Handles subscription
 * changes, participants that were offline at pin time, and substitute peers
 * the allocator picked in the meantime. Runs on the accounting interval.
 * Returns the number of pins re-pinned.
 */
export async function runReallocationJob(
  deps: ReallocationDeps,
): Promise<number> {
  const [pins, peers, subscriptions, mainPeerId] = await Promise.all([
    deps.cluster.pins(),
    deps.cluster.peers(),
    deps.listTagSubscriptions(),
    deps.cluster.id(),
  ]);
  const online = new Set(peers.filter((p) => !p.error).map((p) => p.id));

  const actions = planReallocations(pins, subscriptions, mainPeerId, online);
  let repinned = 0;
  for (const action of actions) {
    try {
      await deps.cluster.pinByCid(action.cid, {
        replicationMin: 1,
        replicationMax: action.allocations.length,
        userAllocations: action.allocations,
        name: action.name || undefined,
        ...(action.tags.length > 0 && {
          metadata: { [TAGS_META_KEY]: action.tags.join(",") },
        }),
      });
      repinned += 1;
    } catch (err) {
      console.error(`[reallocation] re-pin ${action.cid} failed:`, err);
    }
  }
  return repinned;
}
