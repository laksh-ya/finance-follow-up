"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LiveActivityFeed } from "@/components/live-activity-feed";
import { getMetrics, health, sheetsSync, uploadInvoices } from "@/lib/api";
import type { MetricsSnapshot } from "@/lib/types";
import {
  Receipt,
  AlertTriangle,
  Mail,
  UserCheck,
  Clock,
  FileSpreadsheet,
  FileUp,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";

export default function DashboardPage() {
  const [m, setM] = useState<MetricsSnapshot | null>(null);
  const [h, setH] = useState<any>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const tick = () => {
      getMetrics().then(setM).catch(() => {});
      health().then(setH).catch(() => {});
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, []);

  const isEmpty = m && m.totals.invoices === 0;
  const dataSource = h?.data_source || "csv";

  const handleSync = async () => {
    setSyncing(true);
    try {
      const r = await sheetsSync();
      setFeedback(`✓ Synced ${r.synced} invoices`);
      setTimeout(() => setFeedback(null), 4000);
    } catch (e: any) {
      setFeedback(`Error: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {dataSource === "sheets" ? "Live synced with Google Sheets" : "CSV upload mode"} · Overview of your collections pipeline
        </p>
      </div>

      {feedback && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-400">
          <CheckCircle2 className="h-4 w-4" /> {feedback}
        </div>
      )}

      {/* Empty state — Getting Started */}
      {isEmpty && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary" />
              Getting Started
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              No invoices loaded yet. Here&apos;s how to get started:
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Step 1</div>
                <p className="text-sm font-medium">Load your invoices</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {dataSource === "sheets"
                    ? "Click 'Sync Sheets' to pull invoices from your Google Sheet."
                    : "Go to Invoices tab and upload a CSV file."}
                </p>
                {dataSource === "sheets" && (
                  <Button size="sm" variant="outline" className="mt-3" onClick={handleSync} disabled={syncing}>
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    {syncing ? "Syncing…" : "Sync Sheets"}
                  </Button>
                )}
                {dataSource === "csv" && (
                  <Button size="sm" variant="outline" className="mt-3" asChild>
                    <Link href="/invoices"><FileUp className="h-3.5 w-3.5" /> Go to Invoices</Link>
                  </Button>
                )}
              </div>
              <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Step 2</div>
                <p className="text-sm font-medium">Process invoices</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Click &quot;Process All&quot; in the top bar. The AI will analyze each overdue invoice and generate tailored follow-up emails.
                </p>
              </div>
              <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Step 3</div>
                <p className="text-sm font-medium">Review &amp; send</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Low-confidence and high-stage emails go to the Review Queue. Approve, edit, or reject before sending.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI cards */}
      {!isEmpty && m && (
        <div className="grid gap-4 md:grid-cols-5">
          <KpiCard icon={Receipt} label="Total invoices" value={m.totals.invoices} />
          <KpiCard icon={AlertTriangle} label="Overdue" value={m.totals.overdue} color="text-amber-400" />
          <KpiCard icon={Mail} label="Sent today" value={m.totals.sent_today} color="text-emerald-400" />
          <KpiCard icon={UserCheck} label="Pending review" value={m.totals.human_pending} color="text-blue-400" link="/human-queue" />
          <KpiCard icon={Clock} label="Paid" value={m.totals.paid} color="text-emerald-400" />
        </div>
      )}

      {/* Stage breakdown + Activity */}
      {!isEmpty && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Stage breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {m ? (
                <div className="space-y-2">
                  {Object.entries(m.stage_counts).map(([stage, count]) => (
                    <div key={stage} className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{stage}</span>
                      <div className="flex items-center gap-2">
                        <div className="h-2 rounded-full bg-primary/20" style={{ width: Math.max(8, (count / Math.max(1, m.totals.invoices)) * 200) }}>
                          <div className="h-full rounded-full bg-primary" style={{ width: "100%" }} />
                        </div>
                        <span className="text-xs mono w-6 text-right">{count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Skeleton className="h-32" />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Live activity</CardTitle>
            </CardHeader>
            <CardContent>
              <LiveActivityFeed limit={15} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  color,
  link,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  color?: string;
  link?: string;
}) {
  const content = (
    <Card className={link ? "hover:bg-secondary/30 transition-colors cursor-pointer" : ""}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Icon className={`h-3.5 w-3.5 ${color || ""}`} />
          {label}
        </div>
        <p className={`mt-2 text-2xl font-semibold mono ${color || ""}`}>{value}</p>
        {link && (
          <p className="mt-1 text-[10px] text-primary flex items-center gap-1">
            View <ArrowRight className="h-2.5 w-2.5" />
          </p>
        )}
      </CardContent>
    </Card>
  );
  return link ? <Link href={link}>{content}</Link> : content;
}
