import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RaptorForge — the open-source operating system for hackathons",
  description:
    "Self-hostable hackathon submission & judging platform: teams, submissions, deterministic judge assignment, weighted rubrics, cross-judge normalization, community voting, certificates.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
