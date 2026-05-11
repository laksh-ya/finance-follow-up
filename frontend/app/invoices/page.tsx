"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StageChip } from "@/components/stage-chip";
import {
  health,
  invoiceExportUrl,
  listInvoices,
  sampleCsvUrl,
  seedMock,
  sheetsSync,
  triggerScan,
  triggerSingle,
  updateInvoiceStatus,
  uploadInvoices,
} from "@/lib/api";
import type { Invoice, InvoiceStatus } from "@/lib/types";
import { formatDate, formatRelative, cn } from "@/lib/utils";
import {
  Upload,
  Download,
  Search,
  Play,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Mail,
  FileSpreadsheet,
  RotateCcw,
  Loader2,
  Sparkles,
} from "lucide-react";

const STATUS_OPTIONS: InvoiceStatus[] = ["ACTIVE", "PAID", "DISPUTED", "LEGAL", "PAUSED"];
const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "text-foreground",
  PAID: "text-emerald-400",
  DISPUTED: "text-amber-400",
  LEGAL: "text-red-400",
  PAUSED: "text-muted-foreground",
};

export default function InvoicesPage() {
  const [rows, setRows] = useState<Invoice[] | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "">("");
  const [dataSource, setDataSource] = useState<string>("csv");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const data = await listInvoices({ status: statusFilter || undefined, limit: 500 });
    setRows(data);
  }, [statusFilter]);

  useEffect(() => {
    refresh();
    health().then((h) => setDataSource(h.data_source || "csv")).catch(() => {});
    const id = setInterval(refresh, 6000);
    return () => clearInterval(id);
  }, [refresh]);

  const showFeedback = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 4000);
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadErrors([]);
    try {
      const result = await uploadInvoices(file);
      showFeedback(`✓ ${result.inserted} invoices imported`);
      if (result.errors.length > 0) setUploadErrors(result.errors);
      refresh();
    } catch (e: any) {
      setUploadErrors([e.message]);
    } finally {
      setUploading(false);
    }
  };

  const handleStatusChange = async (invoiceId: string, newStatus: InvoiceStatus) => {
    try {
      await updateInvoiceStatus(invoiceId, newStatus);
      showFeedback(`${invoiceId} → ${newStatus}`);
      refresh();
    } catch (e: any) {
      showFeedback(`Error: ${e.message}`);
    }
  };

  const handleGenerate = async (invoiceId: string) => {
    setProcessing(invoiceId);
    try {
      await triggerSingle(invoiceId);
      showFeedback(`✓ ${invoiceId} processed`);
      refresh();
    } catch (e: any) {
      showFeedback(`Error: ${e.message}`);
    } finally {
      setProcessing(null);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const r = await sheetsSync();
      showFeedback(`✓ Synced ${r.synced} invoices from Sheets`);
      refresh();
    } catch (e: any) {
      showFeedback(`Error: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const onScan = async (opts: { force?: boolean; failed_only?: boolean } = {}) => {
    setScanning(true);
    setScanResult(null);
    try {
      const result = await triggerScan(!!opts.force, !!opts.failed_only);
      let msg: string;
      if (opts.failed_only) {
        msg = result.enqueued
          ? `✓ Resent ${result.enqueued} failed invoice(s)`
          : "✓ No failed invoices to resend";
      } else if (result.skipped) {
        msg = `✓ ${result.enqueued} processed, ${result.skipped} skipped`;
      } else {
        msg = `✓ ${result.enqueued} invoices processed`;
      }
      setScanResult(msg);
      setTimeout(() => setScanResult(null), 8000);
      refresh();
    } catch (e: any) {
      setScanResult(`✗ ${e.message}`);
      setTimeout(() => setScanResult(null), 8000);
    } finally {
      setScanning(false);
    }
  };

  const filtered = rows?.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.invoice_id.toLowerCase().includes(q) || r.client_name.toLowerCase().includes(q) || r.client_email.toLowerCase().includes(q);
  });

  const unprocessedCount = rows?.filter((r) => r.status === "ACTIVE" && !r.last_processed_at).length || 0;
  // Failed = latest delivery status is FAILED. Drives the "Resend Failed" CTA.
  const failedCount = rows?.filter((r) => r.last_delivery_status === "FAILED").length || 0;
  const isEmpty = rows !== null && rows.length === 0;

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      {scanning && (
        <div className="h-1 w-full bg-primary/20 overflow-hidden rounded-full">
          <div className="h-full bg-primary animate-pulse rounded-full" style={{ width: "100%" }} />
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
          <p className="text-sm text-muted-foreground">
            {rows ? `${rows.length} invoices` : "Loading…"}
            {unprocessedCount > 0 && ` · ${unprocessedCount} unprocessed`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Sheets sync */}
          {dataSource === "sheets" && (
            <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
              <FileSpreadsheet className="h-3.5 w-3.5" />
              {syncing ? "Syncing…" : "Sync Sheets"}
            </Button>
          )}
          {/* CSV upload */}
          {dataSource === "csv" && (
            <>
              <Button size="sm" variant="outline" asChild>
                <label className="cursor-pointer">
                  <Upload className="h-3.5 w-3.5" /> Upload CSV
                  <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(f);
                    e.target.value = "";
                  }} />
                </label>
              </Button>
              <Button size="sm" variant="ghost" onClick={async () => {
                try { await seedMock(); showFeedback("✓ Sample data loaded"); refresh(); } catch (e: any) { showFeedback(`Error: ${e.message}`); }
              }}>
                <Sparkles className="h-3.5 w-3.5" /> Use Sample
              </Button>
            </>
          )}
          {/* Export */}
          {!isEmpty && (
            <Button size="sm" variant="outline" asChild>
              <a href={invoiceExportUrl()} download><Download className="h-3.5 w-3.5" /> Export</a>
            </Button>
          )}
        </div>
      </div>

      {/* Feedback */}
      {feedback && (
        <div className={cn(
          "flex items-center gap-2 rounded-md border px-4 py-2 text-sm",
          feedback.startsWith("✓") ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-destructive/30 bg-destructive/10 text-destructive"
        )}>
          {feedback.startsWith("✓") ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {feedback}
        </div>
      )}

      {/* Upload errors */}
      {uploadErrors.length > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-3 space-y-1">
            <p className="text-sm font-medium text-destructive flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" /> Upload issues
            </p>
            {uploadErrors.map((err, i) => (
              <p key={i} className="text-xs text-destructive/80 mono">{err}</p>
            ))}
            <Button size="sm" variant="ghost" className="text-xs" asChild>
              <a href={sampleCsvUrl()} download>Download correct format →</a>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {isEmpty && (
        <Card className="border-dashed border-2 border-border/50">
          <CardContent className="py-12 text-center space-y-3">
            <p className="text-muted-foreground">No invoices loaded yet</p>
            {dataSource === "csv" ? (
              <div className="flex items-center justify-center gap-3">
                <Button size="sm" variant="outline" asChild>
                  <label className="cursor-pointer">
                    <Upload className="h-3.5 w-3.5" /> Upload your CSV
                    <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUpload(f);
                      e.target.value = "";
                    }} />
                  </label>
                </Button>
                <span className="text-xs text-muted-foreground">or</span>
                <Button size="sm" variant="ghost" onClick={async () => {
                  try { await seedMock(); showFeedback("✓ Sample data loaded"); refresh(); } catch (e: any) { showFeedback(`Error: ${e.message}`); }
                }}>
                  <Sparkles className="h-3.5 w-3.5" /> Use sample data
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
                <FileSpreadsheet className="h-3.5 w-3.5" /> Sync from Google Sheets
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Process bar — only when there are invoices */}
      {!isEmpty && rows && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border/50 bg-secondary/20 px-4 py-2">
          <Button size="sm" onClick={() => onScan({ force: false })} disabled={scanning}>
            {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {scanning ? "Processing…" : `Process All${unprocessedCount > 0 ? ` (${unprocessedCount} new)` : ""}`}
          </Button>
          {failedCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
              onClick={() => onScan({ failed_only: true })}
              disabled={scanning}
              title="Re-run only invoices whose latest send failed"
            >
              <XCircle className="h-3.5 w-3.5" /> Resend Failed ({failedCount})
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onScan({ force: true })}
            disabled={scanning}
            title="Re-process ALL invoices including already-processed ones"
            className="text-muted-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Force reprocess
          </Button>
          {scanResult && (
            <span className={`text-xs mono ${scanResult.startsWith("✓") ? "text-emerald-400" : "text-destructive"}`}>
              {scanResult}
            </span>
          )}
        </div>
      )}

      {/* Filters */}
      {!isEmpty && (
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search by ID, name, or email…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-8" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as InvoiceStatus | "")} className="h-8 rounded border bg-background px-3 text-xs">
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}

      {/* Table */}
      {!isEmpty && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/30 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Invoice</th>
                    <th className="px-3 py-2 text-left">Client</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2 text-left">Due</th>
                    <th className="px-3 py-2 text-center">Days</th>
                    <th className="px-3 py-2 text-left">Stage</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Last Email</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered === null || filtered === undefined
                    ? [...Array(6)].map((_, i) => (
                        <tr key={i} className="border-t"><td colSpan={9} className="px-3 py-2"><Skeleton className="h-5" /></td></tr>
                      ))
                    : filtered.map((inv) => (
                        <tr key={inv.invoice_id} className="border-t hover:bg-secondary/20 transition-colors">
                          <td className="px-3 py-2">
                            <Link href={`/invoices/${inv.invoice_id}`} className="mono text-primary hover:underline text-xs">{inv.invoice_id}</Link>
                          </td>
                          <td className="px-3 py-2">
                            <div className="text-xs font-medium">{inv.client_name}</div>
                            <div className="text-[10px] text-muted-foreground">{inv.client_email}</div>
                          </td>
                          <td className="px-3 py-2 text-right mono text-xs">{inv.currency} {inv.amount.toLocaleString()}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(inv.due_date)}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={cn("text-xs mono font-medium", inv.days_overdue > 21 ? "text-destructive" : inv.days_overdue > 7 ? "text-amber-400" : "text-foreground")}>{inv.days_overdue}</span>
                          </td>
                          <td className="px-3 py-2"><StageChip stage={inv.stage} /></td>
                          <td className="px-3 py-2">
                            <select
                              value={inv.status}
                              onChange={(e) => handleStatusChange(inv.invoice_id, e.target.value as InvoiceStatus)}
                              className={cn("h-6 rounded border-none bg-transparent text-xs font-medium cursor-pointer", STATUS_COLORS[inv.status])}
                            >
                              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {(() => {
                              if (!inv.last_processed_at) return <span className="text-muted-foreground/50">—</span>;
                              const ds = inv.last_delivery_status;
                              // Map delivery status → icon + colour. Drafts
                              // waiting for human approval show as 'queued',
                              // failures show ✗ with the error in tooltip.
                              const isFailed = ds === "FAILED";
                              const isPending = ds === "HUMAN_PENDING" || ds === "QUEUED" || !ds;
                              const Icon = isFailed ? XCircle : isPending ? AlertTriangle : Mail;
                              const tone = isFailed
                                ? "text-destructive"
                                : isPending
                                  ? "text-amber-400"
                                  : "text-emerald-400";
                              const label = isFailed ? "Failed" : isPending ? "Pending review" : "Delivered";
                              return (
                                <div className="flex items-center gap-1.5" title={inv.last_delivery_error || label}>
                                  <Icon className={`h-3 w-3 ${tone}`} />
                                  <div className="flex flex-col leading-tight">
                                    <span className={`text-[10px] uppercase tracking-wider mono ${tone}`}>{label}</span>
                                    <span className="text-[10px] text-muted-foreground">{formatRelative(inv.last_processed_at)}</span>
                                  </div>
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {inv.status === "ACTIVE" && (
                              <Button
                                size="sm"
                                variant={
                                  inv.last_delivery_status === "FAILED"
                                    ? "outline"
                                    : inv.last_processed_at
                                      ? "ghost"
                                      : "outline"
                                }
                                className={`h-6 text-[10px] px-2 ${
                                  inv.last_delivery_status === "FAILED"
                                    ? "border-destructive/40 text-destructive hover:bg-destructive/10"
                                    : ""
                                }`}
                                disabled={processing === inv.invoice_id}
                                onClick={() => handleGenerate(inv.invoice_id)}
                              >
                                {processing === inv.invoice_id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                                {inv.last_delivery_status === "FAILED"
                                  ? "Retry"
                                  : inv.last_processed_at
                                    ? "Resend"
                                    : "Generate"}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
