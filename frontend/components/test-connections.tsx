"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  testEmail,
  testLLM,
  testRedis,
  testSheets,
} from "@/lib/api";
import type { DiagnosticsResult } from "@/lib/types";
import { CheckCircle2, XCircle, Loader2, Brain, Mail, Database, Sheet } from "lucide-react";

type RowState = {
  status: "idle" | "running" | "ok" | "fail";
  message?: string;
  latency_ms?: number;
};

const initial: RowState = { status: "idle" };

export function TestConnections() {
  const [llm, setLlm] = useState<RowState>(initial);
  const [email, setEmail] = useState<RowState>(initial);
  const [redis, setRedis] = useState<RowState>(initial);
  const [sheets, setSheets] = useState<RowState>(initial);
  const [emailTo, setEmailTo] = useState("");

  const wrap =
    (set: (r: RowState) => void, fn: () => Promise<DiagnosticsResult>) =>
    async () => {
      set({ status: "running" });
      try {
        const r = await fn();
        set({
          status: r.ok ? "ok" : "fail",
          message: r.message,
          latency_ms: r.latency_ms,
        });
      } catch (e: any) {
        set({ status: "fail", message: e.message || String(e) });
      }
    };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test connections</CardTitle>
        <p className="text-xs text-muted-foreground">
          Verify each external service is reachable with current credentials.
          Results never persist or expose secrets.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Row
          icon={Brain}
          label="LLM provider"
          hint="Round-trips one structured-output call to verify LLM connectivity"
          state={llm}
          onRun={wrap(setLlm, testLLM)}
        />
        <Row
          icon={Database}
          label="Redis broker"
          hint="PING via REDIS_URL (Upstash works fine)"
          state={redis}
          onRun={wrap(setRedis, testRedis)}
        />
        <Row
          icon={Sheet}
          label="Google Sheets"
          hint="Reads first row of SHEETS_INVOICE_ID (requires SHEETS_ENABLED=true)"
          state={sheets}
          onRun={wrap(setSheets, testSheets)}
        />
        <div className="rounded-md border border-border/50 bg-secondary/20 p-3">
          <div className="flex items-center gap-3">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1">
              <Label className="text-sm font-medium">Email pipeline</Label>
              <p className="text-xs text-muted-foreground">
                Sends a test email to the address below using the current{" "}
                <code className="mono">EMAIL_MODE</code> (mock / sandbox / live).
              </p>
            </div>
            <StatusIndicator state={email} />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Input
              type="email"
              placeholder="you@yourdomain.com"
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              className="h-8"
            />
            <Button
              size="sm"
              disabled={!emailTo || email.status === "running"}
              onClick={wrap(setEmail, () =>
                testEmail(
                  emailTo,
                  "Test from Finance Collections Agent",
                  "If you can read this, your email pipeline is wired correctly.",
                ),
              )}
            >
              {email.status === "running" ? "Sending…" : "Send test"}
            </Button>
          </div>
          {email.message ? (
            <p
              className={cn(
                "mt-2 text-xs mono",
                email.status === "ok" ? "text-emerald-400" : "text-destructive",
              )}
            >
              {email.message}
              {email.latency_ms ? ` · ${email.latency_ms}ms` : ""}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({
  icon: Icon,
  label,
  hint,
  state,
  onRun,
}: {
  icon: any;
  label: string;
  hint: string;
  state: RowState;
  onRun: () => void;
}) {
  return (
    <div className="rounded-md border border-border/50 bg-secondary/20 p-3">
      <div className="flex items-center gap-3">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <div className="flex-1">
          <Label className="text-sm font-medium">{label}</Label>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <StatusIndicator state={state} />
        <Button
          size="sm"
          variant="outline"
          onClick={onRun}
          disabled={state.status === "running"}
        >
          {state.status === "running" ? "Testing…" : "Test"}
        </Button>
      </div>
      {state.message ? (
        <p
          className={cn(
            "mt-2 text-xs mono",
            state.status === "ok" ? "text-emerald-400" : "text-destructive",
          )}
        >
          {state.message}
          {state.latency_ms ? ` · ${state.latency_ms}ms` : ""}
        </p>
      ) : null}
    </div>
  );
}

function StatusIndicator({ state }: { state: RowState }) {
  if (state.status === "running")
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  if (state.status === "ok")
    return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  if (state.status === "fail")
    return <XCircle className="h-4 w-4 text-destructive" />;
  return null;
}
