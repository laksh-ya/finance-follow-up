"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { getDeadLetter, getMetrics, listAudit, health } from "@/lib/api";
import type { AuditEntry, DeadLetterEntry, MetricsSnapshot } from "@/lib/types";
import { formatRelative } from "@/lib/utils";
import { ExternalLink, BarChart3, Clock, Zap, AlertTriangle } from "lucide-react";

export default function ObservabilityPage() {
  const [m, setM] = useState<MetricsSnapshot | null>(null);
  const [audits, setAudits] = useState<AuditEntry[] | null>(null);
  const [dl, setDl] = useState<DeadLetterEntry[] | null>(null);
  const [h, setH] = useState<any>(null);

  useEffect(() => {
    getMetrics().then(setM);
    listAudit({ limit: 50 }).then(setAudits);
    getDeadLetter().then(setDl);
    health().then(setH).catch(() => {});
  }, []);

  const tokens = audits
    ? audits.reduce((acc, a) => acc + (a.tokens_used || 0), 0)
    : 0;
  const avgLatency = audits && audits.length
    ? Math.round(
        audits.filter((a) => a.latency_ms).reduce((acc, a) => acc + (a.latency_ms || 0), 0) /
          Math.max(1, audits.filter((a) => a.latency_ms).length),
      )
    : 0;
  const fallbackUsed = audits ? audits.filter((a) => a.fallback_used).length : 0;
  const llmCalls = audits ? audits.filter((a) => a.tokens_used).length : 0;

  const monitoringLinks = [
    {
      label: "Langfuse Traces",
      href: "https://us.cloud.langfuse.com",
      description: "LLM observability — prompts, responses, latency, costs",
      color: "text-violet-400",
    },
    {
      label: "Mailtrap Inbox",
      href: "https://mailtrap.io/inboxes",
      description: "Sandbox email previews — see exactly what was sent",
      color: "text-blue-400",
    },
    {
      label: "Neon Database",
      href: "https://console.neon.tech",
      description: "PostgreSQL dashboard — tables, queries, connections",
      color: "text-emerald-400",
    },
    {
      label: "Upstash Redis",
      href: "https://console.upstash.com",
      description: "Redis broker — queue metrics, key browser",
      color: "text-red-400",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Monitoring</h1>
        <p className="text-sm text-muted-foreground">
          LLM performance, pipeline health, external dashboards, and dead-letter queue.
        </p>
      </div>

      {/* KPI row */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <BarChart3 className="h-3.5 w-3.5" />
              Total tokens (last 50)
            </div>
            <p className="mt-3 text-3xl font-semibold mono">{tokens.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Avg latency
            </div>
            <p className="mt-3 text-3xl font-semibold mono">
              {avgLatency ? `${avgLatency}ms` : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <Zap className="h-3.5 w-3.5" />
              LLM calls / Fallbacks
            </div>
            <p className="mt-3 text-3xl font-semibold mono">
              {llmCalls} <span className="text-lg text-muted-foreground">/ {fallbackUsed}</span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5" />
              Dead letters
            </div>
            <p className="mt-3 text-3xl font-semibold mono">
              {dl ? dl.filter((d) => !d.resolved).length : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* System info bar */}
      {h && (
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-4 text-xs mono">
              <span className="rounded bg-primary/10 px-2 py-1 text-primary">
                LLM: {h.llm || "—"}
              </span>
              <span className="rounded bg-secondary px-2 py-1">
                Email: {h.email_mode || "—"}
              </span>
              <span className="rounded bg-secondary px-2 py-1">
                DB: {h.database || "sqlite"}
              </span>
              <span className="rounded bg-secondary px-2 py-1">
                Celery: {h.celery_eager ? "inline" : "workers"}
              </span>
              <span className={`rounded px-2 py-1 ${h.data_source === "sheets" ? "bg-emerald-500/15 text-emerald-400" : "bg-blue-500/15 text-blue-400"}`}>
                {h.data_source === "sheets" ? "Sheets mode" : "CSV mode"}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Monitoring links */}
      <Card>
        <CardHeader><CardTitle>Monitoring dashboards</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2">
            {monitoringLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-start gap-3 rounded-md border border-border/50 bg-secondary/20 p-3 transition-colors hover:bg-secondary/40 hover:border-border"
              >
                <ExternalLink className={`h-4 w-4 mt-0.5 ${link.color}`} />
                <div className="flex-1">
                  <p className={`text-sm font-medium ${link.color}`}>{link.label}</p>
                  <p className="text-xs text-muted-foreground">{link.description}</p>
                </div>
              </a>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* LLM calls + Dead letters */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Recent LLM calls</CardTitle></CardHeader>
          <CardContent>
            {audits === null ? (
              <Skeleton className="h-40" />
            ) : (
              <ul className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1 text-xs mono">
                {audits
                  .filter((a) => a.tokens_used)
                  .slice(0, 30)
                  .map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-2 rounded border border-border/50 bg-secondary/20 px-2 py-1.5"
                    >
                      <span className="truncate">{a.invoice_id}</span>
                      <span className="text-muted-foreground">
                        {a.model_used || "—"}
                      </span>
                      <span>{a.tokens_used}t</span>
                      <span>{a.latency_ms}ms</span>
                      <span className="text-muted-foreground">
                        {formatRelative(a.timestamp)}
                      </span>
                    </li>
                  ))}
                {audits.filter((a) => a.tokens_used).length === 0 ? (
                  <li className="text-muted-foreground">No LLM calls yet. Run a pipeline scan to generate data.</li>
                ) : null}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Dead letter queue</CardTitle></CardHeader>
          <CardContent>
            {dl === null ? (
              <Skeleton className="h-40" />
            ) : dl.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No failed jobs. All pipeline runs completed successfully. ✓
              </p>
            ) : (
              <ul className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1 text-xs">
                {dl.map((d) => (
                  <li
                    key={d.id}
                    className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5"
                  >
                    <div className="flex justify-between">
                      <span className="mono font-medium">{d.invoice_id}</span>
                      <span className="text-muted-foreground">
                        {formatRelative(d.failed_at)}
                      </span>
                    </div>
                    <p className="mt-1 text-destructive/90 line-clamp-2">
                      {d.error_message}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
