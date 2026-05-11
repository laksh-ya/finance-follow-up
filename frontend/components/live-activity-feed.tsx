"use client";

import { useEffect, useState } from "react";
import { getActivityFeed } from "@/lib/api";
import type { ActivityEvent } from "@/lib/types";
import { formatRelative, cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

const LEVEL: Record<string, string> = {
  info: "bg-blue-500/15 text-blue-400",
  warn: "bg-amber-500/15 text-amber-400",
  error: "bg-destructive/15 text-destructive",
  success: "bg-emerald-500/15 text-emerald-400",
};

export function LiveActivityFeed({ limit = 20 }: { limit?: number }) {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      try {
        const data = await getActivityFeed(limit);
        if (mounted) {
          setEvents(data);
          setErr(null);
        }
      } catch (e: any) {
        if (mounted) setErr(e.message || String(e));
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [limit]);

  if (err)
    return (
      <p className="text-xs text-destructive">
        Activity feed offline: {err}
      </p>
    );
  if (!events)
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    );
  if (events.length === 0)
    return (
      <p className="text-xs text-muted-foreground">
        No activity yet. Trigger a scan to see events.
      </p>
    );
  return (
    <ul className="space-y-1.5 max-h-[480px] overflow-y-auto pr-1">
      {events.map((ev) => (
        <li
          key={ev.id}
          className="flex items-start gap-2 rounded-md border border-border/50 bg-secondary/20 px-3 py-2 text-xs"
        >
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 font-medium uppercase mono text-[10px]",
              LEVEL[ev.level] || LEVEL.info,
            )}
          >
            {ev.event_type}
          </span>
          <span className="flex-1 text-muted-foreground">{ev.message}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground/70 mono">
            {formatRelative(ev.timestamp)}
          </span>
        </li>
      ))}
    </ul>
  );
}
