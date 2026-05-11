import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { OnboardingModal } from "@/components/onboarding-modal";

export const metadata: Metadata = {
  title: "Finance Collections Agent",
  description: "AI-powered escalation-aware collections orchestration",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex min-h-screen flex-1 flex-col">
            <Topbar />
            <main className="flex-1 px-6 py-6">{children}</main>
          </div>
        </div>
        {/* First-visit onboarding (renders only when localStorage flag missing). */}
        <OnboardingModal />
      </body>
    </html>
  );
}
