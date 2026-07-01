import type { PeerSnapshot } from "@/lib/api";
import { buildAreaPath } from "@/lib/chart";

const W = 640;
const H = 120;

/** Area chart of bytes held over time (oldest -> newest, left -> right). */
export function ContributionChart({ points }: { points: PeerSnapshot[] }) {
  // Snapshots arrive newest-first; reverse for chronological left-to-right.
  const chronological = [...points].reverse();
  const values = chronological.map((p) => p.bytesHeld);
  const { line, area } = buildAreaPath(values, W, H);

  if (!line) {
    return (
      <p className="text-sm text-muted-foreground">Not enough history yet.</p>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-32 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Bytes held over time"
    >
      <path d={area} className="fill-primary/10" />
      <path
        d={line}
        className="fill-none stroke-primary"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
