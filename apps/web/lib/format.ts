/** Human-readable byte size, e.g. 1536 -> "1.5 KB". */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Compact relative time, e.g. "5m ago", "3d ago". Future dates read "just now". */
export function timeAgo(date: Date, now: Date = new Date()): string {
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 45) return "just now";
  const steps: [limit: number, div: number, unit: string][] = [
    [60, 1, "s"],
    [3600, 60, "m"],
    [86400, 3600, "h"],
    [2592000, 86400, "d"],
    [31536000, 2592000, "mo"],
    [Infinity, 31536000, "y"],
  ];
  for (const [limit, div, unit] of steps) {
    if (seconds < limit) return `${Math.floor(seconds / div)}${unit} ago`;
  }
  return "just now";
}
