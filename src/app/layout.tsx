import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dual-Engine Learning Framework",
  description:
    "Metadata-driven dual-engine personalized learning framework for Outcome-Based Education.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* Keyboard users must be able to bypass panel navigation (NFR-UX-002). */}
        <a href="#main" className="sr-only sr-only-focusable">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
