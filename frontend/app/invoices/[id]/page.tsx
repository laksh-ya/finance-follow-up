"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StageChip } from "@/components/stage-chip";
import { EmailPreview } from "@/components/email-preview";
import { ToneSlider } from "@/components/tone-slider";
import { InvoiceTimeline } from "@/components/invoice-timeline";
import { getInvoice, regenerateEmail, updateInvoiceStatus, triggerSingle } from "@/lib/api";
import type { RegenerateResult } from "@/lib/api";
import type { Invoice as InvoiceType, InvoiceStatus } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/utils";
import { ArrowLeft, RefreshCw, Play } from "lucide-react";

const STATUSES: InvoiceStatus[] = ["ACTIVE", "PAID", "DISPUTED", "LEGAL", "PAUSED"];

export default function InvoiceDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [inv, setInv] = useState<InvoiceType | null>(null);
  const [tone, setTone] = useState<number>(1);
  const [busy, setBusy] = useState<"" | "regen" | "run">("");
  const [result, setResult] = useState<RegenerateResult | null>(null);

  const refresh = async () => {
    const data = await getInvoice(id);
    setInv(data);
    if (data.days_overdue <= 7) setTone(1);
    else if (data.days_overdue <= 14) setTone(2);
    else if (data.days_overdue <= 21) setTone(3);
    else setTone(4);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const onRegen = async () => {
    setBusy("regen");
    try {
      const r = await regenerateEmail(id, tone);
      setResult(r);
      await refresh();
    } finally {
      setBusy("");
    }
  };

  const onRun = async () => {
    setBusy("run");
    try {
      await triggerSingle(id);
      await refresh();
    } finally {
      setBusy("");
    }
  };

  const onStatusChange = async (s: InvoiceStatus) => {
    await updateInvoiceStatus(id, s);
    await refresh();
  };

  if (!inv)
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-32" />
      </div>
    );

  const subject = result?.generated_email?.subject || inv.last_email_subject || "";
  const body = result?.generated_email?.body || inv.last_email_body || "";
  const tonelvl = result?.generated_email?.tone || inv.last_email_tone || null;
  const confidence = result?.confidence_score ?? inv.last_confidence ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button size="icon" variant="ghost" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight mono">
              {inv.invoice_id}
            </h1>
            <p className="text-sm text-muted-foreground">
              {inv.client_name} · {inv.client_email}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onRun} disabled={!!busy}>
            <Play className="h-3.5 w-3.5" />
            {busy === "run" ? "Running pipeline…" : "Run pipeline"}
          </Button>
          <Button size="sm" onClick={onRegen} disabled={!!busy}>
            <RefreshCw className="h-3.5 w-3.5" />
            {busy === "regen" ? "Regenerating…" : "Regenerate"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Invoice</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Field label="Amount">
              <span className="mono">{formatCurrency(inv.amount, inv.currency)}</span>
            </Field>
            <Field label="Due date">{formatDate(inv.due_date)}</Field>
            <Field label="Days overdue">
              <span className="mono">{inv.days_overdue}</span>
            </Field>
            <Field label="Stage"><StageChip stage={inv.stage} /></Field>
            <Field label="Status">
              <select
                value={inv.status}
                onChange={(e) => onStatusChange(e.target.value as InvoiceStatus)}
                className="h-7 rounded border bg-background px-2 text-xs mono"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Followups">
              <span className="mono">{inv.followup_count}</span>
            </Field>
            <Field label="Payment link">
              {inv.payment_link ? (
                <a
                  className="truncate text-primary hover:underline"
                  href={inv.payment_link}
                >
                  open
                </a>
              ) : (
                "—"
              )}
            </Field>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Pipeline controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ToneSlider value={tone} onChange={setTone} disabled={!!busy} />
            {result?.validation_errors?.length ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
                <p className="font-medium text-destructive mb-1">
                  Validation flagged:
                </p>
                <ul className="space-y-0.5 mono text-destructive/90">
                  {result.validation_errors.map((e, i) => (
                    <li key={i}>· {e}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {result?.hallucination_check ? (
              <div className="rounded-md border border-border/50 bg-secondary/20 p-3 text-xs mono">
                hallucination check:{" "}
                <span
                  className={
                    result.hallucination_check.passed
                      ? "text-emerald-400"
                      : "text-destructive"
                  }
                >
                  {result.hallucination_check.passed ? "PASSED" : "FAILED"}
                </span>
                {result.hallucination_check.mismatched_fields.length > 0 ? (
                  <ul className="mt-1">
                    {result.hallucination_check.mismatched_fields.map((m, i) => (
                      <li key={i}>· {m}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {result?.requires_human ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                <span className="text-amber-400 font-medium">
                  Routed to human review queue.
                </span>{" "}
                Reason: <span className="mono">{result.risk_level}</span>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {subject || body ? (
        <EmailPreview
          subject={subject}
          body={body}
          tone={tonelvl}
          confidence={confidence}
          modelUsed={result?.model_used ?? null}
          tokensUsed={result?.tokens_used ?? null}
          latencyMs={result?.latency_ms ?? null}
        />
      ) : (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            No email generated yet for this invoice. Click <b>Run pipeline</b> or{" "}
            <b>Regenerate</b> above.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Customer trail · Timeline</CardTitle>
          <p className="text-xs text-muted-foreground">
            Every event recorded for this invoice — sent emails, audit entries,
            stage changes, human reviews. Click any sent email to expand the
            full body that went out.
          </p>
        </CardHeader>
        <CardContent>
          <InvoiceTimeline invoiceId={id} />
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span>{children}</span>
    </div>
  );
}
