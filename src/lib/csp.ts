/**
 * Origini extra per la Content-Security-Policy (img-src/connect-src).
 *
 * Quando POSTER_CDN_URL (o NEXT_PUBLIC_POSTER_CDN_URL) è impostato, gli URL
 * poster escono con quell'origin mentre la pagina gira altrove: senza
 * allowlist la CSP bloccherebbe <img> e XHR delle preview. Solo
 * scheme+host, mai path/query; env assente → lista vuota (policy invariata).
 * Lettura env iniettata per testabilità (la config passa process.env).
 */
export function cspExtraOrigins(env: Record<string, string | undefined>): string[] {
  const raw = (env.NEXT_PUBLIC_POSTER_CDN_URL || env.POSTER_CDN_URL || "").trim().replace(/\/+$/, "")
  if (!raw) return []
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`)
    if (url.protocol !== "http:" && url.protocol !== "https:") return []
    return [`${url.protocol}//${url.host}`]
  } catch {
    return []
  }
}

export interface CspHeaderOptions {
  /** `true` sotto `next dev`: aggiunge 'unsafe-eval' (React Refresh) e i
   *  websocket HMR, come faceva la CSP congelata in next.config.ts. */
  readonly isDev?: boolean
}

/**
 * Stringa `Content-Security-Policy` completa dalla stessa env di
 * cspExtraOrigins. Puro (solo URL parsing): sicuro da importare nel
 * middleware Edge. Chiamato per-request così un cambio di POSTER_CDN_URL
 * richiede solo restart, mai rebuild (prima la policy era congelata a
 * build time in next.config.ts e il CDN restava bloccato fuori).
 */
export function buildCspHeader(env: Record<string, string | undefined>, opts: CspHeaderOptions = {}): string {
  const isDev = opts.isDev === true
  const cdn = cspExtraOrigins(env).join(" ")
  const cdnSuffix = cdn ? ` ${cdn}` : ""
  // Frame embedding: default compatibile con HF Spaces (l'app gira in
  // iframe); PICTORIUM_FRAME_ANCESTORS lo sovrascrive (es. "'self'" per
  // istanze pubbliche che non vogliono essere embeddate).
  const frameAncestors = (env.PICTORIUM_FRAME_ANCESTORS || "").trim() ||
    "'self' https://huggingface.co https://*.huggingface.co https://*.hf.space"
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://image.tmdb.org https://artworks.thetvdb.com${cdnSuffix}`,
    "font-src 'self'",
    `connect-src 'self'${cdnSuffix}${isDev ? " ws://127.0.0.1:* ws://localhost:*" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
  ].join("; ")
}
