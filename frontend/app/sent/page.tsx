"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StageChip } from "@/components/stage-chip";
import { StatusBadge } from "@/components/status-badge";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { listSentEmails } from "@/lib/api";
import { formatRelative, formatDateTime } from "@/lib/utils";
import type { SentEmail } from "@/lib/types";
import { ChevronDown, ChevronRight, Mail, ExternalLink, UserCheck, Pencil } from "lucide-react";

const STATUS_OPTIONS = ["", "SENT", "SANDBOX", "MOCK", "FAILED", "HUMAN_APPROVED"];
const TONE_LABELS: Record<string, string> = {
  WARM_FRIENDLY: "Warm",
  POLITE_FIRM: "Firm",
  FORMAL_SERIOUS: "Formal",
  STERN_URGENT: "Stern",
};

export default function SentEmailsPage() {
  const [rows, setRows] = useState<SentEmail[] | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const refresh = async () => {
    setRows(null);
    const data = await listSentEmails({
      status: statusFilter || undefined,
      limit: 500,
    });
    setRows(data);
  };

  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      listSentEmails({ status: statusFilter || undefined, limit: 500 })
        .then(setRows)
        .catch(() => {});
    }, 8000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.invoice_id.toLowerCase().includes(q) ||
        r.to_email.toLowerCase().includes(q) ||
        r.subject.toLowerCase().includes(q) ||
        r.body.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const toggle = (id: number) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sent Emails</h1>
          <p className="text-sm text-muted-foreground">
            Every email actually dispatched (or attempted) — full preview of
            subject, body, recipient, tone, provider, and delivery status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search subject / body / client / invoice…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-72"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 rounded border bg-background px-2 text-xs mono"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s || "all delivery statuses"}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filtered === null ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            No sent emails yet. Trigger a scan from the dashboard or process an
            invoice to populate this view.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((em) => {
            const open = !!expanded[em.id];
            return (
              <Card key={em.id} className="transition-colors hover:bg-secondary/10">
                <CardHeader
                  className="cursor-pointer pb-3"
                  onClick={() => toggle(em.id)}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-1 items-start gap-3 min-w-0">
                      {open ? (
                        <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <CardTitle className="truncate text-sm font-medium">
                          {em.subject}
                        </CardTitle>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          to <span className="text-foreground">{em.to_email}</span>{" "}
                          · invoice{" "}
                          <Link
                            href={`/invoices/${em.invoice_id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-primary hover:underline mono"
                          >
                            {em.invoice_id}
                          </Link>
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-xs">
                      <StageChip stage={em.stage} />
                      <span className="rounded bg-secondary px-2 py-0.5 mono">
                        {TONE_LABELS[em.tone] || em.tone}
                      </span>
                      <StatusBadge status={em.status} />
                      <span className="hidden md:inline text-muted-foreground mono">
                        {formatRelative(em.sent_at)}
                      </span>
                    </div>
                  </div>
                </CardHeader>
                {open ? (
                  <CardContent className="space-y-3 border-t pt-4">
                    <div className="grid gap-3 sm:grid-cols-2 text-xs mono">
                      <Meta label="Provider" value={em.provider} />
                      <Meta label="Provider message id" value={em.provider_message_id || "—"} />
                      <Meta label="From" value={em.from_email} />
                      <Meta label="Sent" value={formatDateTime(em.sent_at)} />
                      <Meta label="Model" value={em.model_used || "—"} />
                      <Meta label="Tokens" value={em.tokens_used?.toString() || "—"} />
                    </div>
                    {em.confidence_score != null ? (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">Confidence:</span>
                        <ConfidenceBadge score={em.confidence_score} />
                      </div>
                    ) : null}
                    {em.human_approved ? (
                      <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                        <UserCheck className="h-3.5 w-3.5" />
                        Human approved
                        {em.edited_by_human ? (
                          <span className="ml-2 inline-flex items-center gap-1 text-amber-300">
                            <Pencil className="h-3 w-3" /> reviewer edited
                          </span>
                        ) : null}
                        {em.reviewer_note ? (
                          <span className="ml-2 text-muted-foreground">
                            note: <span className="text-foreground">{em.reviewer_note}</span>
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {em.error_message ? (
                      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                        {em.error_message}
                      </div>
                    ) : null}
                    <pre className="whitespace-pre-wrap break-words rounded-md border bg-secondary/20 p-3 text-sm leading-relaxed">
                      {em.body}
                    </pre>
                    <div className="flex items-center justify-end">
                      <Link
                        href={`/invoices/${em.invoice_id}`}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        Open invoice <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                  </CardContent>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 break-all">{value}</p>
    </div>
  );
}
