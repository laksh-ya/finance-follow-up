import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  loading,
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon?: LucideIcon;
  tone?: "default" | "warn" | "danger" | "success";
  loading?: boolean;
}) {
  const toneCls = {
    default: "text-foreground",
    warn: "text-amber-400",
    danger: "text-destructive",
    success: "text-emerald-400",
  }[tone];
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
          {Icon ? <Icon className="h-4 w-4 text-muted-foreground" /> : null}
        </div>
        <p className={cn("mt-3 text-3xl font-semibold mono", toneCls)}>
          {loading ? "—" : value}
        </p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
