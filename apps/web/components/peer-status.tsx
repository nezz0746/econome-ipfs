import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Online/offline pill for a peer. Online shows a pulsating green dot and when
 * the session started; offline shows a muted dot and when the peer was last
 * seen. The ping animation is suppressed for reduced-motion users.
 */
export function PeerStatus({
  online,
  onlineSince,
  lastSeenAt,
}: {
  online: boolean;
  onlineSince: string | null;
  lastSeenAt: string | null;
}) {
  const since = online ? onlineSince : lastSeenAt;
  const sinceDate = since ? new Date(since) : null;

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium",
          online
            ? "bg-green-500/10 text-green-700 dark:text-green-400"
            : "bg-muted text-muted-foreground",
        )}
      >
        <span className="relative flex size-2">
          {online && (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-500/70 motion-reduce:hidden" />
          )}
          <span
            className={cn(
              "relative inline-flex size-2 rounded-full",
              online ? "bg-green-500" : "bg-muted-foreground/50",
            )}
          />
        </span>
        {online ? "online" : "offline"}
      </span>
      {sinceDate && (
        <span
          className="text-[11px] text-muted-foreground"
          title={sinceDate.toISOString()}
        >
          {online ? "since " : "last seen "}
          {timeAgo(sinceDate)}
        </span>
      )}
    </div>
  );
}
