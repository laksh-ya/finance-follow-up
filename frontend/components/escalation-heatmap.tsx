import { cn } from "@/lib/utils";
import type { EscalationStage } from "@/lib/types";

const ORDER: EscalationStage[] = ["STAGE_1", "STAGE_2", "STAGE_3", "STAGE_4", "ESCALATED"];
const LABEL: Record<EscalationStage, string> = {
  PENDING: "Pending",
  STAGE_1: "Warm",
  STAGE_2: "Firm",
  STAGE_3: "Formal",
  STAGE_4: "Stern",
  ESCALATED: "Escalated",
};
const COLOR: Record<EscalationStage, string> = {
  PENDING: "bg-secondary",
  STAGE_1: "bg-stage1",
  STAGE_2: "bg-stage2",
  STAGE_3: "bg-stage3",
  STAGE_4: "bg-stage4",
  ESCALATED: "bg-stageX",
};

export function EscalationHeatmap({
  counts,
}: {
  counts: Record<EscalationStage, number>;
}) {
  const max = Math.max(1, ...ORDER.map((s) => counts[s] || 0));
  return (
    <div className="space-y-2">
      {ORDER.map((s) => {
        const v = counts[s] || 0;
        const pct = (v / max) * 100;
        return (
          <div key={s} className="flex items-center gap-3">
            <div className="w-20 text-xs text-muted-foreground mono">{LABEL[s]}</div>
            <div className="relative flex-1 h-6 rounded bg-secondary/40 overflow-hidden">
              <div
                className={cn("h-full transition-all", COLOR[s])}
                style={{ width: `${pct}%`, opacity: v === 0 ? 0.2 : 1 }}
              />
              <span className="absolute inset-0 flex items-center px-2 text-xs mono">
                {v}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
