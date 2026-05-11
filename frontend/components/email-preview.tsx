"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfidenceBadge } from "@/components/confidence-badge";

const TONE_LABELS: Record<string, string> = {
  WARM_FRIENDLY: "Warm",
  POLITE_FIRM: "Firm",
  FORMAL_SERIOUS: "Formal",
  STERN_URGENT: "Stern",
};

export function EmailPreview({
  subject,
  body,
  tone,
  confidence,
  modelUsed,
  tokensUsed,
  latencyMs,
  editable,
  onSave,
}: {
  subject: string;
  body: string;
  tone?: string | null;
  confidence?: number | null;
  modelUsed?: string | null;
  tokensUsed?: number | null;
  latencyMs?: number | null;
  editable?: boolean;
  onSave?: (subject: string, body: string) => void | Promise<void>;
}) {
  const [draftSubject, setDraftSubject] = useState(subject);
  const [draftBody, setDraftBody] = useState(body);
  const [edited, setEdited] = useState(false);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Generated Email</CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {tone ? (
              <span className="rounded bg-secondary px-2 py-0.5 mono">
                {TONE_LABELS[tone] || tone}
              </span>
            ) : null}
            <ConfidenceBadge score={confidence ?? null} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Subject</Label>
          {editable ? (
            <Input
              value={draftSubject}
              onChange={(e) => {
                setDraftSubject(e.target.value);
                setEdited(true);
              }}
            />
          ) : (
            <p className="font-medium">{subject}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Body</Label>
          {editable ? (
            <Textarea
              rows={14}
              value={draftBody}
              onChange={(e) => {
                setDraftBody(e.target.value);
                setEdited(true);
              }}
            />
          ) : (
            <pre className="whitespace-pre-wrap break-words rounded-md border bg-secondary/20 p-3 text-sm leading-relaxed">
              {body}
            </pre>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground mono">
          <div className="space-x-4">
            <span>model: <span className="text-foreground">{modelUsed || "—"}</span></span>
            <span>tokens: <span className="text-foreground">{tokensUsed ?? "—"}</span></span>
            <span>latency: <span className="text-foreground">{latencyMs ? `${latencyMs}ms` : "—"}</span></span>
          </div>
          {editable && onSave ? (
            <Button
              size="sm"
              disabled={!edited}
              onClick={() => onSave(draftSubject, draftBody)}
            >
              Save edits
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
