export type EscalationStage =
  | "PENDING"
  | "STAGE_1"
  | "STAGE_2"
  | "STAGE_3"
  | "STAGE_4"
  | "ESCALATED";

export type InvoiceStatus =
  | "ACTIVE"
  | "PAID"
  | "DISPUTED"
  | "LEGAL"
  | "PAUSED";

export type ToneLevel =
  | "WARM_FRIENDLY"
  | "POLITE_FIRM"
  | "FORMAL_SERIOUS"
  | "STERN_URGENT";

export type DeliveryStatus =
  | "QUEUED"
  | "SENT"
  | "FAILED"
  | "SANDBOX"
  | "MOCK"
  | "HUMAN_PENDING"
  | "HUMAN_APPROVED"
  | "HUMAN_REJECTED";

export type AuditAction =
  | "EMAIL_GENERATED"
  | "EMAIL_SENT"
  | "EMAIL_FAILED"
  | "VALIDATION_FAILED"
  | "FALLBACK_USED"
  | "HUMAN_OVERRIDE"
  | "HUMAN_APPROVED"
  | "HUMAN_REJECTED"
  | "STAGE_ESCALATED"
  | "RETRY_TRIGGERED"
  | "INVOICE_INGESTED";

export interface Invoice {
  invoice_id: string;
  client_name: string;
  client_email: string;
  amount: number;
  currency: string;
  due_date: string;
  days_overdue: number;
  followup_count: number;
  stage: EscalationStage;
  status: InvoiceStatus;
  payment_link: string | null;
  notes: string | null;
  last_email_subject: string | null;
  last_email_body: string | null;
  last_email_tone: ToneLevel | null;
  last_confidence: number | null;
  last_processed_at: string | null;
  // Pulled from the most recent SentEmailTable row by the backend so the
  // Invoices table can show a clear ✓ delivered / ✗ failed pill without an
  // extra round-trip per row.
  last_delivery_status: DeliveryStatus | null;
  last_delivery_error: string | null;
  last_delivery_provider: string | null;
}

export interface AuditEntry {
  id: string;
  invoice_id: string;
  timestamp: string;
  action: AuditAction;
  stage: EscalationStage;
  tone_used: ToneLevel | null;
  email_subject: string | null;
  confidence_score: number | null;
  risk_level: string | null;
  tokens_used: number | null;
  latency_ms: number | null;
  retry_count: number;
  fallback_used: boolean;
  delivery_status: DeliveryStatus;
  human_override: boolean;
  override_reason: string | null;
  validation_errors: string[];
  error_message: string | null;
  model_used: string | null;
}

export interface HumanQueueItem {
  id: number;
  invoice_id: string;
  queued_at: string;
  reason: string;
  confidence_score: number;
  risk_level: string;
  email_subject: string;
  email_body: string;
  email_tone: ToneLevel;
  status: DeliveryStatus;
  reviewer_note: string | null;
  reviewed_at: string | null;
}

export interface ActivityEvent {
  id: number;
  timestamp: string;
  invoice_id: string | null;
  event_type: string;
  message: string;
  level: "info" | "warn" | "error" | "success";
}

export interface MetricsSnapshot {
  totals: {
    invoices: number;
    overdue: number;
    paid: number;
    sent_today: number;
    human_pending: number;
    dead_letters: number;
  };
  stage_counts: Record<EscalationStage, number>;
  confidence_distribution: { low: number; medium: number; high: number };
}

export interface ConfigSnapshot {
  data_source: "sheets" | "csv";
  human_in_loop: boolean;
  auto_dispatch: boolean;
  email_mode: "mock" | "sandbox" | "live";
  sheets_enabled: boolean;
  langfuse_enabled: boolean;
  celery_eager: boolean;
  llm: {
    provider: string;
    model: string;
    has_api_key: boolean;
    temperature: number;
    confidence_threshold: number;
  };
}

export interface ConfigPatch {
  data_source?: "sheets" | "csv";
  human_in_loop?: boolean;
  auto_dispatch?: boolean;
  email_mode?: "mock" | "sandbox" | "live";
  sheets_enabled?: boolean;
  langfuse_enabled?: boolean;
  celery_eager?: boolean;
  llm_provider?: string;
  llm_model?: string;
  llm_api_key?: string;
  llm_temperature?: number;
  llm_confidence_threshold?: number;
}

export interface DeadLetterEntry {
  id: number;
  invoice_id: string;
  error_message: string;
  failed_at: string;
  retry_count: number;
  resolved: boolean;
}

export interface SentEmail {
  id: number;
  invoice_id: string;
  audit_id: string | null;
  sent_at: string;
  to_email: string;
  from_email: string;
  subject: string;
  body: string;
  tone: ToneLevel;
  stage: EscalationStage;
  confidence_score: number | null;
  provider: string;
  provider_message_id: string | null;
  status: DeliveryStatus;
  error_message: string | null;
  human_approved: boolean;
  edited_by_human: boolean;
  reviewer_note: string | null;
  model_used: string | null;
  tokens_used: number | null;
}

export type TimelineItem =
  | (TimelineBase & { kind: "audit"; action: AuditAction; stage: EscalationStage; delivery_status: DeliveryStatus; model_used: string | null; tokens_used: number | null; latency_ms: number | null; confidence_score: number | null; fallback_used: boolean; human_override: boolean; validation_errors: string[]; error_message: string | null; subject: string | null })
  | (TimelineBase & { kind: "sent_email"; to_email: string; from_email: string; subject: string; body: string; tone: ToneLevel; stage: EscalationStage; provider: string; provider_message_id: string | null; status: DeliveryStatus; error_message: string | null; human_approved: boolean; edited_by_human: boolean; reviewer_note: string | null; model_used: string | null; tokens_used: number | null; confidence_score: number | null })
  | (TimelineBase & { kind: "activity"; event_type: string; message: string; level: "info" | "warn" | "error" | "success" });

interface TimelineBase {
  id: string | number;
  timestamp: string;
}

export interface DiagnosticsResult {
  ok: boolean;
  message: string;
  latency_ms: number;
  [k: string]: unknown;
}

export interface Envelope<T> {
  success: boolean;
  data: T;
  error: string | null;
}
