import { cn } from "@/lib/utils";
import type { InvoiceStatus, DeliveryStatus } from "@/lib/types";

const MAP: Record<string, string> = {
  ACTIVE: "bg-blue-500/15 text-blue-400",
  PAID: "bg-emerald-500/15 text-emerald-400",
  DISPUTED: "bg-amber-500/15 text-amber-400",
  LEGAL: "bg-stageX/20 text-stageX",
  PAUSED: "bg-secondary text-muted-foreground",
  QUEUED: "bg-blue-500/15 text-blue-400",
  SENT: "bg-emerald-500/15 text-emerald-400",
  FAILED: "bg-destructive/15 text-destructive",
  SANDBOX: "bg-amber-500/15 text-amber-400",
  MOCK: "bg-secondary text-muted-foreground",
  HUMAN_PENDING: "bg-amber-500/15 text-amber-400",
  HUMAN_APPROVED: "bg-emerald-500/15 text-emerald-400",
  HUMAN_REJECTED: "bg-destructive/15 text-destructive",
};

export function StatusBadge({
  status,
  className,
}: {
  status: InvoiceStatus | DeliveryStatus | string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium mono",
        MAP[status] || "bg-secondary text-muted-foreground",
        className,
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
