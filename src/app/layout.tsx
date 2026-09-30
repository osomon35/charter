import type { Metadata } from "next";
import { Caveat, Inter } from "next/font/google";
import { Toaster } from "sonner";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

/**
 * Handwriting face for typed signatures. SIL Open Font License, so it is safe
 * to render into a document that gets sent to other people.
 *
 * Typed signatures are rasterised to PNG in the browser rather than embedded as
 * a font, which is why no .ttf needs vendoring for pdf-lib.
 */
const caveat = Caveat({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "600"],
  variable: "--font-caveat",
});

export const metadata: Metadata = {
  title: { default: "Charter", template: "%s · Charter" },
  description: "Private contract management and electronic signature.",
  // Belt and braces alongside the X-Robots-Tag header in next.config.ts.
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${caveat.variable}`}
      suppressHydrationWarning
    >
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
