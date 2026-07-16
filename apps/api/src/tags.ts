import type { PinInfo } from "./cluster-client";

/**
 * Tag-based partial replication (pure helpers).
 *
 * Untagged content is pinned everywhere (replication factor -1). Tagged
 * content is pinned with explicit `user-allocations`: the main cluster peer
 * plus every participant subscribed to at least one of the pin's tags. The
 * pin itself carries its tags in cluster metadata (`tags` key), so
 * reconciliation works for every ingest path without a DB record.
 */

/** Pin metadata key holding the comma-separated tag list. */
export const TAGS_META_KEY = "tags";

const TAG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export interface TagSubscription {
  peerId: string;
  subscribedTags: string[];
}

/**
 * Normalize a tag list from user input: a comma-separated string or an array
 * of strings. Tags are trimmed, lowercased and deduped. Returns `[]` for
 * absent/empty input, or `null` when any entry is not a valid tag slug.
 */
export function parseTags(input: unknown): string[] | null {
  if (input === undefined || input === null || input === "") return [];
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : null;
  if (raw === null) return null;

  const tags: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") return null;
    const tag = entry.trim().toLowerCase();
    if (tag === "") continue;
    if (!TAG_RE.test(tag)) return null;
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/**
 * Peers that must hold a pin with the given tags: the main peer, then every
 * participant subscribed to at least one of the tags.
 */
export function desiredAllocations(
  tags: string[],
  mainPeerId: string,
  subscriptions: TagSubscription[],
): string[] {
  const allocations = [mainPeerId];
  for (const sub of subscriptions) {
    if (sub.peerId === mainPeerId || allocations.includes(sub.peerId)) continue;
    if (sub.subscribedTags.some((t) => tags.includes(t))) {
      allocations.push(sub.peerId);
    }
  }
  return allocations;
}

/** Tags carried by a pin's cluster metadata, or null when untagged. */
export function pinTags(pin: PinInfo): string[] | null {
  const raw = pin.metadata[TAGS_META_KEY];
  if (!raw) return null;
  const tags = parseTags(raw);
  return tags && tags.length > 0 ? tags : null;
}

export interface RepinAction {
  cid: string;
  name: string;
  tags: string[];
  allocations: string[];
}

/**
 * Decide which tagged pins need a re-pin so their allocations converge on the
 * desired set. A pin is re-pinned iff:
 *
 * 1. a desired peer is online but missing from the pin's allocations
 *    (new subscriber, or a subscriber that was offline at pin time), or
 * 2. the allocations contain peers outside the desired set (unsubscribed, or
 *    substitutes the allocator picked while a subscriber was offline) AND
 *    every desired peer is online — re-pinning earlier would just make the
 *    allocator substitute again.
 *
 * Untagged pins are never touched.
 */
export function planReallocations(
  pins: PinInfo[],
  subscriptions: TagSubscription[],
  mainPeerId: string,
  onlinePeerIds: ReadonlySet<string>,
): RepinAction[] {
  const actions: RepinAction[] = [];
  for (const pin of pins) {
    const tags = pinTags(pin);
    if (!tags) continue;

    const desired = desiredAllocations(tags, mainPeerId, subscriptions);
    const actual = new Set(pin.allocations);

    const missingOnline = desired.some(
      (p) => onlinePeerIds.has(p) && !actual.has(p),
    );
    const hasExtras = pin.allocations.some((p) => !desired.includes(p));
    const allDesiredOnline = desired.every((p) => onlinePeerIds.has(p));

    if (missingOnline || (hasExtras && allDesiredOnline)) {
      actions.push({
        cid: pin.cid,
        name: pin.name,
        tags,
        allocations: desired,
      });
    }
  }
  return actions;
}
