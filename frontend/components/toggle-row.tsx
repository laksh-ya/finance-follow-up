"use client";

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  badge,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (b: boolean) => void;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border/50 bg-secondary/20 px-4 py-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">{label}</Label>
          {badge ? (
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wide mono text-muted-foreground">
              {badge}
            </span>
          ) : null}
        </div>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  );
}
