"use client";

import { useEffect, useState } from "react";
import { getActivityFeed, health } from "@/lib/api";
import type { ActivityEvent } from "@/lib/types";

// Event types we consider "the pipeline is working right now"; when one of
// these shows up in the activity feed within the last few seconds we surface
// a global pulse + label so users on any page get visual feedback.
const ACTIVE_EVENTS = new Set([
  "scan",
  "email_sent",
  "email_failed",
  "human_pending",
  "human_replaced",
  "human_approved",
  "human_rejected",
  "flagged_legal",
  "status_change",
  "upload",
]);
const ACTIVE_WINDOW_MS = 6_000;

export function Topbar() {
  const [status, setStatus] = useState<any>(null);
  const [lastEvent, setLastEvent] = useState<ActivityEvent | null>(null);
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    const tick = () => health().then(setStatus).catch(() => setStatus({ status: "down" }));
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Poll the activity feed. We only care about the newest event because
    // we render a single pulse line; if it's recent and "active" we light up.
    const tick = () =>
      getActivityFeed(1)
        .then((events) => setLastEvent(events?.[0] ?? null))
        .catch(() => {});
    tick();
    const id = setInterval(tick, 2_500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Drive the active-window indicator off the clock so the pulse fades
    // even between event polls.
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const eventAgeMs = lastEvent ? now - new Date(lastEvent.timestamp + "Z").getTime() : Infinity;
  const isProcessing =
    lastEvent != null && ACTIVE_EVENTS.has(lastEvent.event_type) && eventAgeMs < ACTIVE_WINDOW_MS;

  const modeLabel =
    status?.data_source === "sheets" ? "Google Sheets" : status?.data_source === "csv" ? "CSV Mode" : "…";
  const modeColor = status?.data_source === "sheets" ? "text-emerald-400" : "text-blue-400";

  return (
    <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
      {/* Thin progress strip — visible from any page whenever pipeline is busy. */}
      <div
        className={`h-0.5 w-full transition-opacity duration-500 ${
          isProcessing ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="h-full w-full animate-pulse bg-primary" />
      </div>
      <div className="flex items-center justify-between gap-3 px-6 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`h-2 w-2 rounded-full ${
              status?.status === "ok" ? "bg-emerald-400" : "bg-destructive"
            } ${isProcessing ? "animate-ping" : "animate-pulse"}`}
          />
          <span className="text-xs text-muted-foreground mono truncate">
            {status?.status === "ok" ? `${status.llm} · ${status.email_mode}` : "Connecting…"}
          </span>
          {isProcessing && lastEvent && (
            <span className="text-xs text-primary mono truncate max-w-[40ch]" title={lastEvent.message}>
              ▸ {lastEvent.message}
            </span>
          )}
        </div>
        <span className={`text-xs font-medium mono ${modeColor}`}>{modeLabel}</span>
      </div>
    </header>
  );
}
