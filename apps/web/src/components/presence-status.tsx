import type { PresenceStatus } from "@/hooks/usePresence";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<
  PresenceStatus,
  { label: string; dotClass: string; textClass?: string }
> = {
  online: {
    label: "Online",
    dotClass: "bg-emerald-500 ring-emerald-500/30",
    textClass: "text-emerald-600 dark:text-emerald-400",
  },
  away: {
    label: "Away",
    dotClass: "bg-amber-500 ring-amber-500/30",
    textClass: "text-amber-600 dark:text-amber-400",
  },
  offline: {
    label: "Offline",
    dotClass: "bg-muted-foreground/50 ring-transparent",
    textClass: "text-muted-foreground",
  },
};

interface PresenceStatusIndicatorProps {
  status: PresenceStatus;
  showLabel?: boolean;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Small dot (and optional label) for online/away/offline.
 */
export function PresenceStatusIndicator({
  status,
  showLabel = false,
  size = "sm",
  className,
}: PresenceStatusIndicatorProps) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5",
        className
      )}
      title={config.label}
    >
      <span
        className={cn(
          "shrink-0 rounded-full ring-2",
          config.dotClass,
          size === "sm" && "h-2 w-2",
          size === "md" && "h-2.5 w-2.5"
        )}
      />
      {showLabel && (
        <span className={cn("text-xs font-medium", config.textClass)}>
          {config.label}
        </span>
      )}
    </span>
  );
}
