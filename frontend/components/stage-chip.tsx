import { cn } from "@/lib/utils";
import type { EscalationStage } from "@/lib/types";

const MAP: Record<EscalationStage, { label: string; cls: string }> = {
  PENDING: { label: "Pending", cls: "bg-secondary text-muted-foreground" },
  STAGE_1: { label: "S1 · Warm", cls: "bg-stage1/15 text-stage1" },
  STAGE_2: { label: "S2 · Firm", cls: "bg-stage2/15 text-stage2" },
  STAGE_3: { label: "S3 · Formal", cls: "bg-stage3/15 text-stage3" },
  STAGE_4: { label: "S4 · Stern", cls: "bg-stage4/15 text-stage4" },
  ESCALATED: { label: "Escalated", cls: "bg-stageX/20 text-stageX" },
};

export function StageChip({ stage, className }: { stage: EscalationStage; className?: string }) {
  const m = MAP[stage] ?? MAP.PENDING;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium mono",
        m.cls,
        className,
      )}
    >
      {m.label}
    </span>
  );
}
