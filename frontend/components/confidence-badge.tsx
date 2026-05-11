import { cn } from "@/lib/utils";

export function ConfidenceBadge({
  score,
  className,
}: {
  score: number | null | undefined;
  className?: string;
}) {
  if (score == null) {
    return <span className={cn("text-xs text-muted-foreground mono", className)}>—</span>;
  }
  const pct = Math.round(score * 100);
  let label = "LOW";
  let color = "bg-destructive/15 text-destructive";
  if (score >= 0.75) {
    label = "HIGH";
    color = "bg-emerald-500/15 text-emerald-400";
  } else if (score >= 0.5) {
    label = "MED";
    color = "bg-amber-500/15 text-amber-400";
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium mono",
        color,
        className,
      )}
    >
      {label} <span className="opacity-70">{pct}%</span>
    </span>
  );
}
