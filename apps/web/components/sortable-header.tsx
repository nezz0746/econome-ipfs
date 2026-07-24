import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { TableHead } from "@/components/ui/table";
import type { SortDir } from "@/lib/table-sort";

/**
 * A column header that sorts by navigation. The href is built server-side
 * from the current URL state, so this needs no client JS: filters and page
 * size ride along in the query string.
 */
export function SortableHeader({
  label,
  href,
  active,
  dir,
  align = "left",
}: {
  label: string;
  href: string;
  active: boolean;
  dir: SortDir;
  align?: "left" | "right";
}) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={align === "right" ? "text-right" : undefined}
    >
      <a
        href={href}
        className={`inline-flex items-center gap-1 hover:text-foreground ${
          active ? "text-foreground" : ""
        }`}
      >
        <span>{label}</span>
        <Icon
          className={`size-3.5 ${active ? "" : "text-muted-foreground/50"}`}
          aria-hidden="true"
        />
      </a>
    </TableHead>
  );
}
