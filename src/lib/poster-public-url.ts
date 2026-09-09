import type { NextRequest } from "next/server"
import { getDomain } from "@/lib/utils"
import { envWithFallback } from "@/lib/env-compat"

export interface PosterBaseUrlInput {
  readonly origin?: string
  readonly preferCdn?: boolean
}

function cleanBaseUrl(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return trimmed.replace(/\/+$/, "")
}

function hostnameOf(value: string): string | null {
  // X-Forwarded-Host può essere una lista separata da virgole
  const first = value.split(",")[0].trim()
  try {
    return new URL(`https://${first}`).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** Allowlist opzionale di hostname pubblici ammessi (PICTORIUM_ALLOWED_HOSTS). */
function isAllowedHostname(hostname: string): boolean {
  const raw = envWithFallback("ALLOWED_HOSTS")
  if (!raw) return false
  const allowed = raw.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)
  return allowed.includes(hostname)
}

/**
 * Extract the public origin from a request, accounting for reverse proxies
 * (Koyeb, HF Spaces, etc.) that forward via internal IPs.
 *
 * X-Forwarded-Host è fidato solo se combacia con l'Host header originale
 * (o è in PICTORIUM_ALLOWED_HOSTS): in caso contrario un client può far
 * generare URL poster che puntano a un dominio arbitrario (host header
 * injection). Su HF Spaces / proxy fidati XFH == Host → nessun cambiamento
 * di comportamento.
 */
export function getOriginFromRequest(req: NextRequest): string {
  const forwardedHost = req.headers.get("X-Forwarded-Host")
  const forwardedProto = req.headers.get("X-Forwarded-Proto") || "https"
  if (forwardedHost) {
    const xfhHost = hostnameOf(forwardedHost)
    const host = hostnameOf(req.headers.get("host") || "")
    if (xfhHost && (host === xfhHost || isAllowedHostname(xfhHost))) {
      const firstHost = forwardedHost.split(",")[0].trim()
      return `${forwardedProto}://${firstHost}`
    }
    // XFH non fidato → fallback all'origin derivato dall'URL della richiesta.
    return req.nextUrl.origin
  }
  return req.nextUrl.origin
}

export function getPosterPublicBaseUrl(input: PosterBaseUrlInput = {}): string {
  const cdnBase = input.preferCdn !== false
    ? cleanBaseUrl(process.env.NEXT_PUBLIC_POSTER_CDN_URL || process.env.POSTER_CDN_URL)
    : null
  if (cdnBase) return cdnBase
  const explicitOrigin = cleanBaseUrl(input.origin)
  if (explicitOrigin) return explicitOrigin
  return getDomain()
}

export function buildPosterPublicUrl(path: string, input: PosterBaseUrlInput = {}): URL {
  const baseUrl = getPosterPublicBaseUrl(input)
  if (baseUrl) return new URL(path, `${baseUrl}/`)
  return new URL(path, "http://localhost")
}
