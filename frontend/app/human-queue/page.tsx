"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { humanAction, listHumanQueue } from "@/lib/api";
import { formatRelative } from "@/lib/utils";
import type { HumanQueueItem } from "@/lib/types";
import { Check, X, Flag, RefreshCw, Pencil, Send, AlertTriangle } from "lucide-react";

const REASON_LABELS: Record<string, string> = {
  low_confidence: "AI wasn't confident enough",
  stage_4_final_notice: "Stage 4 — final notice before legal",
  stage_escalated_30plus: "30+ days overdue — needs manual review",
  fallback_used: "AI failed, using template",
  auto_dispatch_disabled: "Auto-send is off",
};

// Ordered category definitions. Items are placed into the FIRST matching
// category, so put the most specific reasons first.
const CATEGORIES: Array<{
  key: string;
  title: string;
  description: string;
  match: (r: string) => boolean;
  accent: string; // tailwind colour for the section badge
}> = [
  {
    key: "escalated",
    title: "Escalated (30+ days)",
    description: "Flag for legal review — pipeline did not generate an email.",
    match: (r) => r === "stage_escalated_30plus",
    accent: "border-destructive/40 text-destructive bg-destructive/5",
  },
  {
    key: "stage4",
    title: "Stage 4 — Final Notice",
    description: "Last reminder before legal escalation. Approve, edit, or flag.",
    match: (r) => r === "stage_4_final_notice",
    accent: "border-amber-500/40 text-amber-400 bg-amber-500/5",
  },
  {
    key: "low_conf",
    title: "Low AI Confidence",
    description: "AI was uncertain — please verify before sending.",
    match: (r) => r === "low_confidence",
    accent: "border-blue-500/40 text-blue-400 bg-blue-500/5",
  },
  {
    key: "fallback",
    title: "Fallback Templates",
    description: "AI failed after retries; deterministic template was used.",
    match: (r) => r === "fallback_used",
    accent: "border-purple-500/40 text-purple-400 bg-purple-500/5",
  },
  {
    key: "manual",
    title: "Manual Review (Auto-send off)",
    description: "All drafts route here while Auto-dispatch is off.",
    match: (r) => r === "auto_dispatch_disabled",
    accent: "border-secondary text-muted-foreground bg-secondary/30",
  },
  {
    key: "other",
    title: "Other",
    description: "Drafts that didn't fit a known reason.",
    match: () => true,
    accent: "border-secondary text-muted-foreground bg-secondary/20",
  },
];

function categoryFor(reason: string): (typeof CATEGORIES)[number] {
  return CATEGORIES.find((c) => c.match(reason)) || CATEGORIES[CATEGORIES.length - 1];
}

export default function HumanQueuePage() {
  const [rows, setRows] = useState<HumanQueueItem[] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, { subject: string; body: string; note: string }>>({});
  const [feedback, setFeedback] = useState<Record<number, string>>({});

  const refresh = async () => {
    const data = await listHumanQueue(true);
    setRows(data);
  };

  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      listHumanQueue(true).then(setRows).catch(() => {});
    }, 8000);
    return () => clearInterval(id);
  }, []);

  const draft = (r: HumanQueueItem) =>
    drafts[r.id] || { subject: r.email_subject, body: r.email_body, note: "" };

  const setDraft = (id: number, p: Partial<{ subject: string; body: string; note: string }>) => {
    setDrafts((d) => ({ ...d, [id]: { ...draft({ id, email_subject: "", email_body: "" } as any), ...d[id], ...p } }));
  };

  const act = async (
    r: HumanQueueItem,
    action: "approve" | "edit" | "reject" | "regenerate" | "flag",
  ) => {
    const d = draft(r);
    try {
      await humanAction(r.id, {
        invoice_id: r.invoice_id,
        action,
        edited_subject: action === "edit" ? d.subject : undefined,
        edited_body: action === "edit" ? d.body : undefined,
        reviewer_note: d.note || undefined,
      });
      const messages: Record<string, string> = {
        approve: "✓ Email sent to client",
        edit: "✓ Edited email sent to client",
        reject: "✗ Email discarded — no email sent",
        regenerate: "↻ New AI draft generated — check queue",
        flag: "⚠ Invoice flagged for legal — removed from queue",
      };
      setFeedback((f) => ({ ...f, [r.id]: messages[action] || "Done" }));
      setTimeout(() => {
        setFeedback((f) => { const next = { ...f }; delete next[r.id]; return next; });
      }, 3000);
    } catch (err: any) {
      setFeedback((f) => ({ ...f, [r.id]: `Error: ${err.message}` }));
    }
    await refresh();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Review Queue</h1>
        <p className="text-sm text-muted-foreground">
          Emails that need your approval before being sent. Stage 4, low-confidence, and escalated invoices land here.
        </p>
      </div>

      {/* Quick legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><Check className="h-3 w-3 text-emerald-400" /> Approve = send email to client</span>
        <span className="flex items-center gap-1"><X className="h-3 w-3 text-destructive" /> Reject = discard, no email sent</span>
        <span className="flex items-center gap-1"><Flag className="h-3 w-3 text-amber-400" /> Legal = flag invoice for legal team</span>
      </div>

      {rows === null ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            ✓ All clear — no emails pending review. Go to{" "}
            <Link href="/invoices" className="text-primary hover:underline">Invoices</Link> and click &quot;Generate&quot; to create new drafts.
          </CardContent>
        </Card>
      ) : (
        (() => {
          // Bucket queue items by category. Preserve queue order inside each
          // bucket so newer drafts surface first within their category.
          const buckets = new Map<string, HumanQueueItem[]>();
          for (const r of rows) {
            const cat = categoryFor(r.reason);
            const list = buckets.get(cat.key) || [];
            list.push(r);
            buckets.set(cat.key, list);
          }
          const renderItem = (r: HumanQueueItem) => {
            const d = draft(r);
            const isEditing = editing === r.id;
            const fb = feedback[r.id];
            return (
              <Card key={r.id} className={fb ? (fb.startsWith("✓") ? "border-emerald-500/30" : fb.startsWith("✗") ? "border-destructive/30" : "") : ""}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle>
                        <Link
                          href={`/invoices/${r.invoice_id}`}
                          className="hover:text-primary mono"
                        >
                          {r.invoice_id}
                        </Link>
                      </CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatRelative(r.queued_at)} ·{" "}
                        <span className="text-foreground">{REASON_LABELS[r.reason] || r.reason}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <ConfidenceBadge score={r.confidence_score} />
                      <span className="rounded bg-secondary px-2 py-0.5 text-xs mono">
                        {r.email_tone.replace("_", " ")}
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {isEditing ? (
                    <>
                      <Input
                        value={d.subject}
                        onChange={(e) => setDraft(r.id, { subject: e.target.value })}
                        placeholder="Subject line"
                      />
                      <Textarea
                        rows={10}
                        value={d.body}
                        onChange={(e) => setDraft(r.id, { body: e.target.value })}
                      />
                    </>
                  ) : (
                    <>
                      <p className="font-medium">{r.email_subject}</p>
                      <pre className="whitespace-pre-wrap break-words rounded-md border bg-secondary/20 p-3 text-sm leading-relaxed">
                        {r.email_body}
                      </pre>
                    </>
                  )}
                  <Input
                    placeholder="Add a note (optional) — visible in audit log"
                    value={d.note}
                    onChange={(e) => setDraft(r.id, { note: e.target.value })}
                  />
                  {fb && (
                    <p className={`text-xs font-medium ${fb.startsWith("✓") ? "text-emerald-400" : fb.startsWith("✗") ? "text-muted-foreground" : "text-amber-400"}`}>
                      {fb}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {isEditing ? (
                      <>
                        <Button size="sm" onClick={() => act(r, "edit").then(() => setEditing(null))}>
                          <Send className="h-3.5 w-3.5" /> Save & send
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" onClick={() => act(r, "approve")}>
                          <Check className="h-3.5 w-3.5" /> Approve & send
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditing(r.id)}>
                          <Pencil className="h-3.5 w-3.5" /> Edit first
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => act(r, "regenerate")}>
                          <RefreshCw className="h-3.5 w-3.5" /> New draft
                        </Button>
                        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => act(r, "reject")}>
                          <X className="h-3.5 w-3.5" /> Discard
                        </Button>
                        <Button size="sm" variant="ghost" className="text-amber-400 hover:text-amber-300" onClick={() => {
                          if (!confirm("Flag this invoice for legal? The invoice will be marked LEGAL and removed from email processing.")) return;
                          act(r, "flag");
                        }}>
                          <Flag className="h-3.5 w-3.5" /> Legal
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          };

          // Render each category that has at least one item, in the order
          // defined by CATEGORIES (highest-urgency first).
          return (
            <div className="space-y-8">
              <p className="text-xs text-muted-foreground">
                {rows.length} email{rows.length !== 1 ? "s" : ""} waiting for review · grouped by reason
              </p>
              {CATEGORIES.map((cat) => {
                const items = buckets.get(cat.key);
                if (!items || items.length === 0) return null;
                return (
                  <section key={cat.key} className="space-y-3">
                    <div className={`flex items-baseline justify-between rounded-md border px-3 py-2 ${cat.accent}`}>
                      <div>
                        <h2 className="text-sm font-semibold tracking-tight">
                          {cat.title}{" "}
                          <span className="ml-1 rounded bg-background/40 px-1.5 py-0.5 text-[10px] mono">
                            {items.length}
                          </span>
                        </h2>
                        <p className="text-[11px] opacity-80 mt-0.5">{cat.description}</p>
                      </div>
                    </div>
                    <div className="space-y-4">{items.map(renderItem)}</div>
                  </section>
                );
              })}
            </div>
          );
        })()
      )}
    </div>
  );
}
