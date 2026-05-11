"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Receipt,
  UserCheck,
  ScrollText,
  Settings,
  Zap,
  Mail,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { health } from "@/lib/api";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, desc: "KPIs & activity" },
  { href: "/invoices", label: "Invoices", icon: Receipt, desc: "All invoices" },
  { href: "/human-queue", label: "Review Queue", icon: UserCheck, desc: "Pending approval" },
  { href: "/sent", label: "Sent Emails", icon: Mail, desc: "Delivery log" },
  { href: "/audit", label: "Audit Log", icon: ScrollText, desc: "Full history" },
  { href: "/observability", label: "Monitoring", icon: Activity, desc: "LLM & health" },
  { href: "/settings", label: "Settings", icon: Settings, desc: "Configuration" },
];

export function Sidebar() {
  const pathname = usePathname();
  const [status, setStatus] = useState<any>(null);

  useEffect(() => {
    const tick = () => health().then(setStatus).catch(() => {});
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, []);

  const dataSource = status?.data_source || "…";
  const sourceColor = dataSource === "sheets"
    ? "text-emerald-400"
    : dataSource === "csv"
      ? "text-blue-400"
      : "text-muted-foreground";

  return (
    <aside className="hidden md:flex w-56 shrink-0 flex-col border-r bg-card/50">
      <div className="flex items-center gap-2 px-4 py-4 border-b">
        <div className="flex h-7 w-7 items-center justify-center rounded bg-primary/15 text-primary">
          <Zap className="h-3.5 w-3.5" />
        </div>
        <div>
          <p className="text-sm font-semibold leading-none">Finance Agent</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            Collections AI
          </p>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 px-2 py-3">
        {NAV.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                active
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className={cn("border-t px-4 py-2.5 text-[10px] uppercase tracking-wider mono flex items-center gap-1.5", sourceColor)}>
        <span className={cn("h-1.5 w-1.5 rounded-full", dataSource === "sheets" ? "bg-emerald-400" : "bg-blue-400")} />
        {dataSource === "sheets" ? "Google Sheets" : dataSource === "csv" ? "CSV Mode" : "…"}
      </div>
    </aside>
  );
}
