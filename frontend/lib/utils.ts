import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency = "INR"): string {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    // Due dates are date-only strings like "2026-05-08" — parse as UTC to avoid timezone shift
    const d = iso.length <= 10 ? new Date(iso + "T00:00:00Z") : parseUtc(iso);
    return d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    });
  } catch {
    return iso;
  }
}

/**
 * Parse an ISO timestamp from the backend.
 * Backend stores UTC but omits the "Z" suffix — we append it so the
 * browser's Date constructor treats it as UTC, not local time.
 */
function parseUtc(iso: string): Date {
  // If it already ends with Z or has a timezone offset, leave it
  if (/[Zz]$/.test(iso) || /[+-]\d{2}:\d{2}$/.test(iso)) {
    return new Date(iso);
  }
  return new Date(iso + "Z");
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = parseUtc(iso).getTime();
  const diff = Math.floor((Date.now() - t) / 1000);
  if (diff < 0) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return parseUtc(iso).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}
