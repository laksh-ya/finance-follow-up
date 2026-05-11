"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { StageChip } from "@/components/stage-chip";
import { StatusBadge } from "@/components/status-badge";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { getInvoiceTimeline } from "@/lib/api";
import type { TimelineItem } from "@/lib/types";
import { cn, formatRelative } from "@/lib/utils";
import {
  Mail,
  Activity,
  ScrollText,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  UserCheck,
  Pencil,
} from "lucide-react";

const KIND_ICON = {
  audit: ScrollText,
  sent_email: Mail,
  activity: Activity,
};

export function InvoiceTimeline({ invoiceId }: { invoiceId: string }) {
  const [items, setItems] = useState<TimelineItem[] | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      try {
        const data = await getInvoiceTimeline(invoiceId);
        if (mounted) setItems(data);
      } catch (e) {
        console.error(e);
      }
    };
    tick();
    const id = setInterval(tick, 6000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [invoiceId]);

  if (items === null)
    return (
      <div className="space-y-2">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );

  if (items.length === 0)
    return (
      <p className="rounded-md border bg-secondary/20 p-6 text-center text-sm text-muted-foreground">
        No events recorded yet for this invoice.
      </p>
    );

  return (
    <ol className="relative space-y-2 border-l border-border/40 pl-4">
      {items.map((it) => {
        const key = `${it.kind}-${it.id}`;
        const Icon = KIND_ICON[it.kind] || Activity;
        const isOpen = !!expanded[key];
        const canExpand = it.kind === "sent_email" || it.kind === "audit";

        return (
          <li key={key} className="relative">
            <span className="absolute -left-[22px] top-3 h-2 w-2 rounded-full bg-primary/50" />
            <div
              className={cn(
                "rounded-md border border-border/50 bg-secondary/20 transition-colors",
                canExpand && "cursor-pointer hover:bg-secondary/40",
              )}
              onClick={() =>
                canExpand && setExpanded((e) => ({ ...e, [key]: !e[key] }))
              }
            >
              <div className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs">
                {canExpand ? (
                  isOpen ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  )
                ) : null}
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground mono">
                  {formatRelative(it.timestamp)}
                </span>
                {renderHeader(it)}
              </div>

              {isOpen && it.kind === "sent_email" ? (
                <div className="space-y-2 border-t px-3 py-3 text-xs">
                  <p className="text-muted-foreground">
                    to <span className="text-foreground mono">{it.to_email}</span>{" "}
                    · from <span className="mono">{it.from_email}</span>
                  </p>
                  <p className="font-medium">{it.subject}</p>
                  <pre className="whitespace-pre-wrap break-words rounded-md border bg-background/40 p-3 text-sm leading-relaxed">
                    {it.body}
                  </pre>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground mono">
                    <span>provider: <span className="text-foreground">{it.provider}</span></span>
                    {it.provider_message_id ? (
                      <span>id: <span className="text-foreground">{it.provider_message_id}</span></span>
                    ) : null}
                    {it.model_used ? (
                      <span>model: <span className="text-foreground">{it.model_used}</span></span>
                    ) : null}
                    {it.tokens_used ? <span>tokens: {it.tokens_used}</span> : null}
                    {it.confidence_score != null ? (
                      <ConfidenceBadge score={it.confidence_score} />
                    ) : null}
                  </div>
                  {it.human_approved ? (
                    <div className="flex items-center gap-2 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-300">
                      <UserCheck className="h-3 w-3" /> human approved
                      {it.edited_by_human ? (
                        <span className="ml-2 flex items-center gap-1 text-amber-300">
                          <Pencil className="h-3 w-3" /> edited
                        </span>
                      ) : null}
                      {it.reviewer_note ? (
                        <span className="ml-2 text-muted-foreground">
                          note: <span className="text-foreground">{it.reviewer_note}</span>
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {it.error_message ? (
                    <div className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-destructive">
                      {it.error_message}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {isOpen && it.kind === "audit" ? (
                <div className="grid gap-2 border-t px-3 py-3 text-[11px] mono sm:grid-cols-2">
                  {it.subject ? (
                    <div className="sm:col-span-2">
                      <span className="text-muted-foreground">subject:</span>{" "}
                      {it.subject}
                    </div>
                  ) : null}
                  <div>model: <span className="text-foreground">{it.model_used || "—"}</span></div>
                  <div>delivery: <span className="text-foreground">{it.delivery_status}</span></div>
                  <div>tokens: <span className="text-foreground">{it.tokens_used ?? "—"}</span></div>
                  <div>latency: <span className="text-foreground">{it.latency_ms ? `${it.latency_ms}ms` : "—"}</span></div>
                  {it.fallback_used ? (
                    <div className="text-amber-300">fallback used</div>
                  ) : null}
                  {it.human_override ? (
                    <div className="text-amber-300">human override</div>
                  ) : null}
                  {it.validation_errors.length > 0 ? (
                    <div className="sm:col-span-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-destructive">
                      validation: {it.validation_errors.join(" · ")}
                    </div>
                  ) : null}
                  {it.error_message ? (
                    <div className="sm:col-span-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-destructive">
                      {it.error_message}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function renderHeader(it: TimelineItem) {
  if (it.kind === "audit") {
    return (
      <>
        <span className="rounded bg-secondary px-1.5 py-0.5 mono">{it.action}</span>
        <StageChip stage={it.stage} className="ml-1" />
        <StatusBadge status={it.delivery_status} className="ml-1" />
        {it.fallback_used ? (
          <span className="ml-1 inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-400">
            <AlertTriangle className="h-3 w-3" /> fallback
          </span>
        ) : null}
      </>
    );
  }
  if (it.kind === "sent_email") {
    return (
      <>
        <span className="truncate font-medium text-foreground">{it.subject}</span>
        <StatusBadge status={it.status} className="ml-1" />
      </>
    );
  }
  // activity
  return (
    <>
      <span className="rounded bg-secondary px-1.5 py-0.5 mono">{it.event_type}</span>
      <span className="text-muted-foreground">{it.message}</span>
    </>
  );
}
