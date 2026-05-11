"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { StageChip } from "@/components/stage-chip";
import { StatusBadge } from "@/components/status-badge";
import { auditExportUrl, listAudit } from "@/lib/api";
import { formatRelative, formatDateTime } from "@/lib/utils";
import type { AuditAction, AuditEntry } from "@/lib/types";
import { Download } from "lucide-react";

const ACTIONS: AuditAction[] = [
  "EMAIL_SENT",
  "EMAIL_FAILED",
  "EMAIL_GENERATED",
  "FALLBACK_USED",
  "HUMAN_OVERRIDE",
  "HUMAN_APPROVED",
  "HUMAN_REJECTED",
  "STAGE_ESCALATED",
  "VALIDATION_FAILED",
  "RETRY_TRIGGERED",
];

export default function AuditPage() {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [filterAction, setFilterAction] = useState<AuditAction | "">("");
  const [filterInvoice, setFilterInvoice] = useState("");

  const refresh = async () => {
    const data = await listAudit({
      action: (filterAction || undefined) as any,
      invoice_id: filterInvoice || undefined,
    });
    setRows(data);
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterAction, filterInvoice]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
          <p className="text-sm text-muted-foreground">
            Every pipeline step recorded — append-only, exportable.
          </p>
        </div>
        <Button asChild size="sm">
          <a href={auditExportUrl()} download="audit_log.csv">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </a>
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Filters
          </CardTitle>
          <div className="flex items-center gap-2">
            <Input
              placeholder="invoice_id"
              value={filterInvoice}
              onChange={(e) => setFilterInvoice(e.target.value)}
              className="h-8 w-44"
            />
            <select
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value as any)}
              className="h-8 rounded border bg-background px-2 text-xs mono"
            >
              <option value="">all actions</option>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">When</th>
                  <th className="px-3 py-2 text-left">Invoice</th>
                  <th className="px-3 py-2 text-left">Action</th>
                  <th className="px-3 py-2 text-left">Stage</th>
                  <th className="px-3 py-2 text-left">Delivery</th>
                  <th className="px-3 py-2 text-right">Conf</th>
                  <th className="px-3 py-2 text-right">Tokens</th>
                  <th className="px-3 py-2 text-right">Latency</th>
                  <th className="px-3 py-2 text-left">Model</th>
                </tr>
              </thead>
              <tbody>
                {rows === null
                  ? [...Array(8)].map((_, i) => (
                      <tr key={i} className="border-t">
                        <td colSpan={9} className="px-3 py-2">
                          <Skeleton className="h-5" />
                        </td>
                      </tr>
                    ))
                  : rows.length === 0
                    ? (
                      <tr>
                        <td
                          colSpan={9}
                          className="px-3 py-10 text-center text-muted-foreground"
                        >
                          No audit entries match.
                        </td>
                      </tr>
                    )
                    : rows.map((r) => (
                        <tr key={r.id} className="border-t hover:bg-secondary/20">
                          <td className="px-3 py-2 mono text-xs text-muted-foreground" title={formatDateTime(r.timestamp)}>
                            {formatRelative(r.timestamp)}
                          </td>
                          <td className="px-3 py-2 mono">{r.invoice_id}</td>
                          <td className="px-3 py-2">
                            <span className="rounded bg-secondary px-1.5 py-0.5 text-xs mono">
                              {r.action}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <StageChip stage={r.stage} />
                          </td>
                          <td className="px-3 py-2">
                            <StatusBadge status={r.delivery_status} />
                          </td>
                          <td className="px-3 py-2 text-right mono">
                            {r.confidence_score
                              ? r.confidence_score.toFixed(2)
                              : "—"}
                          </td>
                          <td className="px-3 py-2 text-right mono">
                            {r.tokens_used ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-right mono">
                            {r.latency_ms ? `${r.latency_ms}ms` : "—"}
                          </td>
                          <td className="px-3 py-2 mono text-xs text-muted-foreground">
                            {r.model_used || "—"}
                          </td>
                        </tr>
                      ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
