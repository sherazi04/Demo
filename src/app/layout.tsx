import type { Metadata } from "next";
import { Hanken_Grotesk, JetBrains_Mono, Manrope } from "next/font/google";
import "./globals.css";

/**
 * Three typefaces, each doing one job:
 *
 *   Hanken Grotesk — headlines. Tighter and more editorial than the body face.
 *   Manrope        — body and UI. Wide apertures, legible at 14px on navy.
 *   JetBrains Mono — metadata, engine status, data labels. Anything the system
 *                    emits about itself is set in mono, so a reader can tell at
 *                    a glance what the machine said from what a person wrote.
 *
 * Self-hosted by next/font, so no render-blocking request to Google and no
 * layout shift when the face swaps in.
 */
const display = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display",
  display: "swap",
});

const sans = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Dual-Engine Learning Framework",
  description:
    "Metadata-driven dual-engine personalized learning framework for Outcome-Based Education.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans">
        {/* Keyboard users must be able to bypass panel navigation (NFR-UX-002). */}
        <a href="#main" className="sr-only sr-only-focusable">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
