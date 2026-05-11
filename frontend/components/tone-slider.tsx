"use client";

import { cn } from "@/lib/utils";

const TONES = [
  { stage: 1, label: "Warm", color: "stage1" },
  { stage: 2, label: "Firm", color: "stage2" },
  { stage: 3, label: "Formal", color: "stage3" },
  { stage: 4, label: "Stern", color: "stage4" },
] as const;

export function ToneSlider({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (stage: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Override tone</span>
        <span className="mono">stage {value}</span>
      </div>
      <div className="flex gap-1.5">
        {TONES.map((t) => {
          const active = value === t.stage;
          return (
            <button
              key={t.stage}
              type="button"
              disabled={disabled}
              onClick={() => onChange(t.stage)}
              className={cn(
                "flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors",
                active
                  ? `bg-${t.color}/20 text-${t.color} border-${t.color}/40`
                  : "border-border/40 text-muted-foreground hover:bg-secondary",
                disabled && "opacity-50 cursor-not-allowed",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
