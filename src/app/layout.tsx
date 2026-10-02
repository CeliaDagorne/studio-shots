import { Analytics } from "@vercel/analytics/next";
import { Fraunces, Outfit } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SITE_DESCRIPTION, SITE_TITLE } from "@/lib/website-copy";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";

import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
});

const sans = Outfit({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`} suppressHydrationWarning>
      <head>
        <script
          // Runs before paint so the first frame matches stored / system preference.
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
        />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
