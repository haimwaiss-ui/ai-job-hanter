import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Job Hunter | העבודה הבאה שלך מתחילה כאן",
  description: "מרכז חכם לניהול חיפוש עבודה, התאמת משרות ומעקב מועמדויות.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
