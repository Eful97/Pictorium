import { NextResponse } from "next/server"
import { buildCspHeader } from "@/lib/csp"

/**
 * CSP calcolata dall'env viva (mai congelata a build time come prima in
 * next.config.ts): con POSTER_CDN_URL impostato gli URL poster escono
 * cross-origin e la policy deve ammetterne scheme+host, altrimenti il
 * browser blocca <img> e XHR delle preview ("Failed to load poster preview"
 * sul tasto Testa URL Stremio). Un cambio CDN richiede solo restart, mai
 * rebuild (verdetto Step 0 misurato su Next 16.3.3: l'env qui si legge a
 * runtime; il proxy gira di default sul runtime Node.js).
 *
 * Memoizzata a livello modulo: env e NODE_ENV sono immutabili per la vita
 * del processo (Docker/K8s: un cambio richiede restart, che azzera il
 * modulo) — niente parsing URL per-request sulla pipeline calda.
 */
let cachedCsp: string | null = null

function cspHeader(): string {
  if (cachedCsp === null) {
    cachedCsp = buildCspHeader(process.env as unknown as Record<string, string | undefined>, {
      isDev: process.env.NODE_ENV === "development",
    })
  }
  return cachedCsp
}

export function proxy() {
  const res = NextResponse.next()
  res.headers.set("Content-Security-Policy", cspHeader())
  return res
}

// La CSP è applicata dai browser solo sui documenti HTML: API JSON,
// poster/binari, asset public e interni Next la ignorerebbero comunque —
// escluderli risparmia il passaggio proxy sulla pipeline ad alto throughput
// (poster) e sugli statici. Pagine HTML (/, /configure, /status, /u/*,
// /c/*) restano coperte.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
}
