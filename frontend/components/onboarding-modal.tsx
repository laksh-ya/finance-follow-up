"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ToggleRow } from "@/components/toggle-row";
import { getConfig, patchConfig } from "@/lib/api";
import type { ConfigSnapshot } from "@/lib/types";
import { FileSpreadsheet, FileUp, X, ArrowRight, Loader2 } from "lucide-react";

const LS_KEY = "fca.onboarded.v1";

/**
 * First-visit onboarding modal.
 *
 * Asks the user to pick a data source (Google Sheets vs CSV) and configure
 * the two pipeline toggles that materially change behaviour
 * (human-in-the-loop, auto-dispatch). Persists a flag in localStorage so the
 * modal never re-appears. Settings → Session Management can re-trigger it
 * by clearing this key.
 *
 * The modal is intentionally a single component (no router, no portals) so
 * it ships with zero extra dependencies and works inside the existing layout.
 */
export function OnboardingModal() {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<ConfigSnapshot | null>(null);
  const [source, setSource] = useState<"sheets" | "csv">("csv");
  const [hil, setHil] = useState(true);
  const [autoDispatch, setAutoDispatch] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(LS_KEY)) return;
    getConfig()
      .then((c) => {
        setCfg(c);
        setSource(c.data_source);
        setHil(c.human_in_loop);
        setAutoDispatch(c.auto_dispatch);
        setOpen(true);
      })
      .catch(() => {
        // Backend unreachable — don't block the UI; treat as already-onboarded.
        localStorage.setItem(LS_KEY, "1");
      });
  }, []);

  const dismiss = () => {
    if (typeof window !== "undefined") localStorage.setItem(LS_KEY, "1");
    setOpen(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      // Only patch fields the user actually changed.
      const patch: Record<string, unknown> = {};
      if (cfg && source !== cfg.data_source) patch.data_source = source;
      if (cfg && hil !== cfg.human_in_loop) patch.human_in_loop = hil;
      if (cfg && autoDispatch !== cfg.auto_dispatch) patch.auto_dispatch = autoDispatch;
      if (Object.keys(patch).length > 0) await patchConfig(patch);
      dismiss();
    } catch {
      // Best-effort: still close so the user can configure manually in Settings.
      dismiss();
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <Card className="w-full max-w-lg border-primary/30 shadow-2xl">
        <CardContent className="p-6 space-y-5">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Welcome 👋</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Quick setup — two questions and you&apos;re done.
              </p>
            </div>
            <button
              onClick={dismiss}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Skip onboarding"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Question 1: data source */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Where are your invoices?</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setSource("sheets")}
                className={`rounded-md border-2 p-3 text-left transition-all ${
                  source === "sheets"
                    ? "border-emerald-500 bg-emerald-500/10"
                    : "border-border hover:bg-secondary/30"
                }`}
              >
                <FileSpreadsheet
                  className={`h-5 w-5 mb-1.5 ${
                    source === "sheets" ? "text-emerald-400" : "text-muted-foreground"
                  }`}
                />
                <div className="text-sm font-medium">Google Sheets</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Live sync with read/write back. Recommended for teams.
                </div>
              </button>
              <button
                onClick={() => setSource("csv")}
                className={`rounded-md border-2 p-3 text-left transition-all ${
                  source === "csv"
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-border hover:bg-secondary/30"
                }`}
              >
                <FileUp
                  className={`h-5 w-5 mb-1.5 ${
                    source === "csv" ? "text-blue-400" : "text-muted-foreground"
                  }`}
                />
                <div className="text-sm font-medium">Upload CSV</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  One-shot session. Upload, process, download. Nothing persists.
                </div>
              </button>
            </div>
          </div>

          {/* Question 2: pipeline toggles */}
          <div className="space-y-3">
            <p className="text-sm font-medium">How aggressive should the agent be?</p>
            <div className="space-y-2 rounded-md border bg-secondary/20 px-3 py-2">
              <ToggleRow
                label="Human-in-the-loop"
                description="Stage 4 (final notice) and low-confidence drafts go to Review Queue."
                checked={hil}
                onCheckedChange={setHil}
              />
              <div className="border-t border-border/40" />
              <ToggleRow
                label="Auto-dispatch"
                description="Confident stage 1–3 emails send automatically. Off → everything goes to review."
                checked={autoDispatch}
                onCheckedChange={setAutoDispatch}
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t">
            <Button size="sm" variant="ghost" onClick={dismiss} disabled={saving}>
              Skip
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowRight className="h-3.5 w-3.5" />
              )}
              Get started
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground text-center">
            You can change any of this later in Settings.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
