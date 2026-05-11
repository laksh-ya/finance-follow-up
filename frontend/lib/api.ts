import type {
  ActivityEvent,
  AuditAction,
  AuditEntry,
  ConfigPatch,
  ConfigSnapshot,
  DeadLetterEntry,
  DiagnosticsResult,
  Envelope,
  HumanQueueItem,
  Invoice,
  InvoiceStatus,
  MetricsSnapshot,
  SentEmail,
  TimelineItem,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "dev-secret-key";

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": API_KEY,
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  // CSV download endpoints don't use envelope
  if (res.headers.get("content-type")?.includes("text/csv")) {
    return (await res.blob()) as unknown as T;
  }
  const json = (await res.json()) as Envelope<T>;
  if (!json.success) throw new Error(json.error || "API error");
  return json.data as T;
}

// ---- invoices
export const listInvoices = (params: {
  status?: InvoiceStatus;
  stage?: string;
  limit?: number;
} = {}) => {
  const q = new URLSearchParams();
  if (params.status) q.set("status", params.status);
  if (params.stage) q.set("stage", params.stage);
  if (params.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return request<Invoice[]>(`/api/invoices${qs ? `?${qs}` : ""}`);
};
export const getInvoice = (id: string) => request<Invoice>(`/api/invoices/${id}`);
export const updateInvoiceStatus = (id: string, status: InvoiceStatus, notes?: string) =>
  request<Invoice>(`/api/invoices/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, notes }),
  });
export const uploadInvoices = async (file: File) => {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${API_URL}/api/invoices/upload`, {
    method: "POST",
    headers: { "X-API-Key": API_KEY },
    body: fd,
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || "upload failed");
  return json.data as { inserted: number; errors: string[] };
};

// ---- emails
export interface RegenerateResult {
  generated_email: {
    subject: string;
    body: string;
    tone: string;
    escalation_stage: number;
    confidence_score: number;
  } | null;
  confidence_score: number;
  risk_level: string;
  requires_human: boolean;
  model_used: string | null;
  tokens_used: number | null;
  latency_ms: number | null;
  validation_errors: string[];
  hallucination_check: { passed: boolean; mismatched_fields: string[] } | null;
}
export const previewEmail = (id: string) =>
  request<{
    subject: string;
    body: string;
    tone: string;
    confidence_score: number;
    processed_at: string;
  } | null>(`/api/emails/preview/${id}`);
export const regenerateEmail = (id: string, tone_override?: number) =>
  request<RegenerateResult>(`/api/emails/regenerate/${id}`, {
    method: "POST",
    body: JSON.stringify({ tone_override }),
  });

// ---- human queue
export const listHumanQueue = (pending_only = true) =>
  request<HumanQueueItem[]>(`/api/human-queue?pending_only=${pending_only}`);
export const humanAction = (
  id: number,
  payload: {
    invoice_id: string;
    action: "approve" | "edit" | "reject" | "regenerate" | "flag";
    edited_subject?: string;
    edited_body?: string;
    reviewer_note?: string;
  },
) =>
  request<{ action: string; queue_id: number }>(`/api/human-queue/${id}/action`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

// ---- audit
export const listAudit = (params: {
  invoice_id?: string;
  action?: AuditAction;
  limit?: number;
} = {}) => {
  const q = new URLSearchParams();
  if (params.invoice_id) q.set("invoice_id", params.invoice_id);
  if (params.action) q.set("action", params.action);
  if (params.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return request<AuditEntry[]>(`/api/audit${qs ? `?${qs}` : ""}`);
};
export const auditExportUrl = () => `${API_URL}/api/audit/export`;

// ---- metrics
export const getMetrics = () => request<MetricsSnapshot>("/api/metrics");
export const getActivityFeed = (limit = 20) =>
  request<ActivityEvent[]>(`/api/metrics/activity-feed?limit=${limit}`);
export const getDeadLetter = () =>
  request<DeadLetterEntry[]>("/api/metrics/dead-letter");

// ---- triggers
export const triggerScan = (force = false, failed_only = false) =>
  request<{ enqueued: number; skipped: number; failed_only?: boolean }>(
    `/api/trigger/scan?force=${force}&failed_only=${failed_only}`,
    { method: "POST" },
  );
export const triggerSingle = (id: string) =>
  request<{ status: string; invoice_id: string; stage: number }>(
    `/api/trigger/invoice/${id}`,
    { method: "POST" },
  );

// ---- config
export const getConfig = () => request<ConfigSnapshot>("/api/config");
export const patchConfig = (patch: ConfigPatch) =>
  request<ConfigSnapshot>("/api/config", { method: "PATCH", body: JSON.stringify(patch) });
export const seedMock = () => request<{ seeded: number }>("/api/config/seed", { method: "POST" });
export const resetDb = () => request<{ reset: boolean }>("/api/config/reset", { method: "POST" });

// ---- sheets
export const sheetsStatus = () =>
  request<{ enabled: boolean; last_sync_at: string | null; last_row_count: number }>(
    "/api/sheets/status",
  );
export const sheetsSync = () =>
  request<{ synced: number; skipped?: boolean; reason?: string; error?: string }>(
    "/api/sheets/sync",
    { method: "POST" },
  );

// ---- health (no auth needed)
export const health = async () => {
  const res = await fetch(`${API_URL}/health`, { cache: "no-store" });
  return res.json();
};

// ---- sent emails
export const listSentEmails = (params: {
  invoice_id?: string;
  status?: string;
  limit?: number;
} = {}) => {
  const q = new URLSearchParams();
  if (params.invoice_id) q.set("invoice_id", params.invoice_id);
  if (params.status) q.set("status", params.status);
  if (params.limit) q.set("limit", String(params.limit));
  const qs = q.toString();
  return request<SentEmail[]>(`/api/sent-emails${qs ? `?${qs}` : ""}`);
};
export const getSentEmail = (id: number) => request<SentEmail>(`/api/sent-emails/${id}`);

// ---- per-invoice timeline
export const getInvoiceTimeline = (id: string, limit = 200) =>
  request<TimelineItem[]>(`/api/invoices/${id}/timeline?limit=${limit}`);

// ---- public sample CSV (no auth)
export const sampleCsvUrl = () => `${API_URL}/api/invoices/sample-csv`;
export const invoiceExportUrl = () => `${API_URL}/api/invoices/export`;
export const sentEmailsExportUrl = () => `${API_URL}/api/sent-emails/export/csv`;

// ---- diagnostics
export const healthDeep = () => request<any>("/api/diagnostics/health-deep");
export const testLLM = () => request<DiagnosticsResult>("/api/diagnostics/test/llm", { method: "POST" });
export const testEmail = (to_email: string, subject?: string, body?: string) =>
  request<DiagnosticsResult>("/api/diagnostics/test/email", {
    method: "POST",
    body: JSON.stringify({ to_email, subject, body }),
  });
export const testRedis = () => request<DiagnosticsResult>("/api/diagnostics/test/redis", { method: "POST" });
export const testSheets = () => request<DiagnosticsResult>("/api/diagnostics/test/sheets", { method: "POST" });
