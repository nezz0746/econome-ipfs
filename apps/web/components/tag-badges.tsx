import { Badge } from "@/components/ui/badge";

/** Inline list of replication-tag badges; renders a muted dash when empty. */
export function TagBadges({
  tags,
  emptyLabel = "—",
}: {
  tags: string[];
  emptyLabel?: string;
}) {
  if (tags.length === 0) {
    return <span className="text-muted-foreground">{emptyLabel}</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <Badge key={tag} variant="outline" className="font-mono text-xs">
          {tag}
        </Badge>
      ))}
    </span>
  );
}
