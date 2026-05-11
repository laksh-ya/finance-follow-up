"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ToggleRow } from "@/components/toggle-row";
import { TestConnections } from "@/components/test-connections";
import {
  getConfig,
  health,
  patchConfig,
  resetDb,
  seedMock,
  sheetsStatus,
  sheetsSync,
} from "@/lib/api";
import type { ConfigSnapshot } from "@/lib/types";
import { Database, Key, RotateCcw, Sparkles, RefreshCw, CheckCircle2, FileSpreadsheet, FileUp } from "lucide-react";

const PROVIDERS = ["groq", "gemini", "openai", "ollama", "together"];
const EMAIL_MODES: Array<"mock" | "sandbox" | "live"> = ["mock", "sandbox", "live"];
const EMAIL_MODE_DESC: Record<string, string> = {
  mock: "Emails logged, NOT sent",
  sandbox: "Sent to Mailtrap test inbox",
  live: "Sent to real addresses",
};

export default function SettingsPage() {
  const [cfg, setCfg] = useState<ConfigSnapshot | null>(null);
  const [llmKey, setLlmKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheets, setSheets] = useState<{ enabled: boolean; last_sync_at: string | null; last_row_count: number } | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [h, setH] = useState<any>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const refresh = async () => {
    const c = await getConfig();
    setCfg(c);
    sheetsStatus().then(setSheets).catch(() => {});
    health().then(setH).catch(() => {});
  };

  useEffect(() => { refresh(); }, []);

  const patch = async (data: any) => {
    setBusy(true);
    try {
      const next = await patchConfig(data);
      setCfg(next);
      setFeedback("Settings updated");
      setTimeout(() => setFeedback(null), 3000);
    } finally {
      setBusy(false);
    }
  };

  if (!cfg) return <div className="space-y-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32" />)}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Configure data source, AI model, and email delivery.</p>
      </div>

      {feedback && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-400">
          <CheckCircle2 className="h-4 w-4" /> {feedback}
        </div>
      )}

      {/* Data source — THE most important setting */}
      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle>Data Source</CardTitle>
          <p className="text-xs text-muted-foreground">Where do your invoices come from?</p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              onClick={() => patch({ data_source: "sheets" })}
              className={`rounded-lg border-2 p-4 text-left transition-all ${
                cfg.data_source === "sheets"
                  ? "border-emerald-500 bg-emerald-500/10"
                  : "border-border hover:border-border/80 hover:bg-secondary/30"
              }`}
            >
              <div className="flex items-center gap-2">
                <FileSpreadsheet className={`h-5 w-5 ${cfg.data_source === "sheets" ? "text-emerald-400" : "text-muted-foreground"}`} />
                <span className="font-medium">Google Sheets</span>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Live sync — reads invoices from your sheet, writes back status changes and audit entries.
              </p>
            </button>
            <button
              onClick={() => patch({ data_source: "csv" })}
              className={`rounded-lg border-2 p-4 text-left transition-all ${
                cfg.data_source === "csv"
                  ? "border-blue-500 bg-blue-500/10"
                  : "border-border hover:border-border/80 hover:bg-secondary/30"
              }`}
            >
              <div className="flex items-center gap-2">
                <FileUp className={`h-5 w-5 ${cfg.data_source === "csv" ? "text-blue-400" : "text-muted-foreground"}`} />
                <span className="font-medium">CSV Upload</span>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Upload a CSV, process it, download the results. No persistent sync.
              </p>
            </button>
          </div>

          {cfg.data_source === "sheets" && (
            <div className="mt-4 flex items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await sheetsSync();
                    setSyncResult(`Synced ${r.synced} invoices`);
                    refresh();
                  } catch (e: any) {
                    setSyncResult(`Error: ${e.message}`);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Sync from Sheets
              </Button>
              {syncResult && <span className="text-xs mono text-emerald-400">{syncResult}</span>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Core behavior */}
      <Card>
        <CardHeader><CardTitle>Pipeline behavior</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow
            label="Human-in-the-loop"
            description="Stage 4 and low-confidence emails go to Review Queue before sending."
            checked={cfg.human_in_loop}
            onCheckedChange={(v) => patch({ human_in_loop: v })}
          />
          <Separator />
          <ToggleRow
            label="Auto-dispatch"
            description="Stage 1-3 emails sent automatically. When OFF, ALL emails go to Review Queue."
            checked={cfg.auto_dispatch}
            onCheckedChange={(v) => patch({ auto_dispatch: v })}
          />
        </CardContent>
      </Card>

      {/* LLM */}
      <Card>
        <CardHeader><CardTitle>AI model (LLM)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Provider</Label>
              <select
                value={cfg.llm.provider}
                onChange={(e) => patch({ llm_provider: e.target.value })}
                className="mt-1 h-9 w-full rounded border bg-background px-3 text-sm"
              >
                {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <Label>Model name</Label>
              <Input value={cfg.llm.model} onChange={(e) => patch({ llm_model: e.target.value })} className="mt-1" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>API key {cfg.llm.has_api_key && <span className="text-emerald-400 text-xs">(set)</span>}</Label>
              <div className="mt-1 flex gap-2">
                <Input type="password" placeholder={cfg.llm.has_api_key ? "••••••••" : "Paste API key"} value={llmKey} onChange={(e) => setLlmKey(e.target.value)} />
                <Button size="sm" disabled={!llmKey} onClick={() => { patch({ llm_api_key: llmKey }); setLlmKey(""); }}>
                  <Key className="h-3.5 w-3.5" /> Save
                </Button>
              </div>
            </div>
            <div>
              <Label>Confidence threshold</Label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-1">Below this → email goes to Review Queue</p>
              <Input type="number" min={0} max={1} step={0.05} value={cfg.llm.confidence_threshold} onChange={(e) => patch({ llm_confidence_threshold: parseFloat(e.target.value) })} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Email */}
      <Card>
        <CardHeader><CardTitle>Email delivery</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {EMAIL_MODES.map((mode) => (
              <button
                key={mode}
                onClick={() => patch({ email_mode: mode })}
                className={`flex-1 rounded-md border px-4 py-2.5 text-sm transition-colors ${
                  cfg.email_mode === mode ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:bg-secondary"
                }`}
              >
                <span className="font-medium capitalize">{mode}</span>
                <p className="mt-0.5 text-[10px]">{EMAIL_MODE_DESC[mode]}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Test connections */}
      <Card>
        <CardHeader><CardTitle>Test connections</CardTitle></CardHeader>
        <CardContent><TestConnections /></CardContent>
      </Card>

      {/* Session management */}
      <Card>
        <CardHeader>
          <CardTitle>Session management</CardTitle>
          <p className="text-xs text-muted-foreground">
            {cfg.data_source === "csv"
              ? "CSV mode — data exists only in this session. Clear to start fresh."
              : "Sheets mode — data is synced from your Google Sheet. Clear local cache if needed."}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="destructive" disabled={busy} onClick={async () => {
              const msg = cfg.data_source === "csv"
                ? "Clear this CSV session? All uploaded invoices, emails, and audit data will be removed."
                : "Clear local sheets cache? You'll need to re-sync from Google Sheets.";
              if (!confirm(msg)) return;
              setBusy(true);
              try {
                await resetDb();
                setFeedback(cfg.data_source === "csv" ? "CSV session cleared" : "Sheets cache cleared — re-sync to reload");
              } finally { setBusy(false); refresh(); }
            }}>
              <RotateCcw className="h-3.5 w-3.5" />
              {cfg.data_source === "csv" ? "Clear CSV Session" : "Clear Sheets Cache"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
