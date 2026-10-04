import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { Check, Info, AlertTriangle, AlertCircle } from "lucide-react";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t;try{t=localStorage.getItem("pictorium_ui_theme");}catch(e){}var s=t==="light"||t==="dark"?t:"system";var d=s==="system"?(typeof window.matchMedia==="function"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):"dark"):s;document.documentElement.setAttribute("data-theme",d);document.documentElement.setAttribute("data-theme-setting",s);document.documentElement.classList.add(d);document.documentElement.classList.remove(d==="dark"?"light":"dark");})();`,
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
          <Toaster
            position="bottom-right"
            duration={3000}
            closeButton={false}
            richColors={false}
            icons={{
              success: <Check className="w-3.5 h-3.5 stroke-[2.5]" />,
              info: <Info className="w-3.5 h-3.5 stroke-[2.5]" />,
              warning: <AlertTriangle className="w-3.5 h-3.5 stroke-[2.5]" />,
              error: <AlertCircle className="w-3.5 h-3.5 stroke-[2.5]" />,
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
