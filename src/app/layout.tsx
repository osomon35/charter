import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: { default: "Charter", template: "%s · Charter" },
  description: "Private contract management and electronic signature.",
  // Belt and braces alongside the X-Robots-Tag header in next.config.ts.
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>
        {/* Must be the first thing in the body: it sets the `dark` class before
            anything paints, so dark mode does not flash white on every load. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {children}
        <Toaster position="bottom-right" toastOptions={{ duration: 4000 }} />
      </body>
    </html>
  );
}
