import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ResponsiveToaster } from "@/components/ResponsiveToaster";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://pictorium.app"),
  title: "Pictorium — Generatore di poster per Stremio",
  description: "Generatore dinamico di poster cinematografici per Stremio: locandine pulite, loghi vettoriali, rating e badge trend composti in tempo reale.",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/App.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
      { url: "/App.png", sizes: "512x512", type: "image/png" },
    ],
  },
  openGraph: {
    title: "Pictorium",
    description: "Generatore di poster cinematografici per Stremio",
    images: ["/pictorium.png"],
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#e85d2a",
};

import { ThemeProvider } from "@/lib/contexts/ThemeContext";
import { DOCUMENT_LANG_PREPAINT_SCRIPT } from "@/lib/i18n";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" dir="ltr" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t;try{t=localStorage.getItem("pictorium_ui_theme");}catch(e){}var s=t==="light"||t==="dark"?t:"system";var d=s==="system"?(typeof window.matchMedia==="function"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):"dark"):s;document.documentElement.setAttribute("data-theme",d);document.documentElement.setAttribute("data-theme-setting",s);document.documentElement.classList.add(d);document.documentElement.classList.remove(d==="dark"?"light":"dark");})();`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            // Pre-paint language/direction (see DOCUMENT_LANG_PREPAINT_SCRIPT):
            // persisted lang + matching dir before first paint, no LTR flash.
            __html: DOCUMENT_LANG_PREPAINT_SCRIPT,
          }}
        />
        <link rel="preconnect" href="https://image.tmdb.org" />
        <link rel="preconnect" href="https://api.themoviedb.org" />
      </head>
      <body className="min-h-full" suppressHydrationWarning>
        <ThemeProvider>
          <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[200] focus:bg-accent-orange focus:text-white focus:px-4 focus:py-2 focus:rounded-xl">
            Skip to main content
          </a>
          <main id="main-content">{children}</main>
          <ResponsiveToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
