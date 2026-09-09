import crypto from "node:crypto"
import { createLogger } from "@/lib/logger"
import { envWithFallback } from "@/lib/env-compat"
import { hasPinConfiguredSync, verifySessionFromRequestSync } from "@/lib/pin-auth"

const log = createLogger("auth")

function resolveAdminToken(): string | undefined {
  return envWithFallback("ADMIN_TOKEN") || process.env.ADMIN_TOKEN || undefined
}

/** Istanza in modalità pubblica: le route admin restano aperte senza
 *  ADMIN_TOKEN solo quando esplicitamente configurata via
 *  PICTORIUM_PUBLIC_INSTANCE=1 (legacy: POSTERIUM_PUBLIC_INSTANCE=1, HF Spaces multi-utente). In dev locale
 *  (`next dev`, NODE_ENV=development) l'accesso senza token è consentito
 *  solo su loopback (127.0.0.1/::1/localhost) o con PICTORIUM_ALLOW_DEV_ADMIN=1 (legacy: POSTERIUM_ALLOW_DEV_ADMIN=1).
 *  In produzione senza flag resta fail-closed. */
function isPublicInstance(): boolean {
  return envWithFallback("PUBLIC_INSTANCE") === "1"
}

function isLoopbackRequest(request: Request): boolean {
  try {
    const hostname = new URL(request.url).hostname.toLowerCase()
    if (hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost") return true
  } catch {}
  const hostHeader = request.headers.get("host")
  if (hostHeader) {
    const h = hostHeader.split(":")[0].trim().toLowerCase()
    if (h === "127.0.0.1" || h === "::1" || h === "localhost") return true
  }
  return false
}

function isDevAdminAllowed(request: Request): boolean {
  if (process.env.NODE_ENV !== "development") return false
  if (envWithFallback("ALLOW_DEV_ADMIN") === "1") return true
  return isLoopbackRequest(request)
}

if (!resolveAdminToken() && !isPublicInstance()) {
  if (process.env.NODE_ENV === "development") {
    if (envWithFallback("ALLOW_DEV_ADMIN") === "1") {
      log.warn("⚠️  Dev locale con PICTORIUM_ALLOW_DEV_ADMIN=1 senza ADMIN_TOKEN — route admin APERTE in dev (esplicito).")
      log.warn("   Imposta PICTORIUM_ADMIN_TOKEN (o ADMIN_TOKEN) per proteggerle anche in dev.")
    } else {
      log.warn("⚠️  Dev locale senza ADMIN_TOKEN — route admin APERTE solo su loopback (127.0.0.1/localhost) o con PICTORIUM_ALLOW_DEV_ADMIN=1.")
      log.warn("   - Per aprire ovunque in dev: PICTORIUM_ALLOW_DEV_ADMIN=1")
      log.warn("   - Istanza privata: imposta PICTORIUM_ADMIN_TOKEN (o ADMIN_TOKEN) per chiudere ovunque")
    }
  } else {
    log.warn("⚠️  Nessun ADMIN_TOKEN configurato e modalità pubblica non attiva — route admin CHIUSE (fail-closed).")
    log.warn("   - Istanza pubblica (HF Spaces multi-utente): imposta PICTORIUM_PUBLIC_INSTANCE=1")
    log.warn("   - Istanza privata: imposta PICTORIUM_ADMIN_TOKEN (o ADMIN_TOKEN) (x-admin-token / Bearer)")
  }
} else if (!resolveAdminToken()) {
  log.warn("⚠️  Modalità pubblica senza ADMIN_TOKEN — route admin APERTE (PICTORIUM_PUBLIC_INSTANCE=1).")
  log.warn("   Imposta PICTORIUM_ADMIN_TOKEN (o ADMIN_TOKEN) per proteggerle.")
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export function checkAdminToken(request: Request): boolean {
  const token = resolveAdminToken()
  if (token) {
    const headers = request.headers
    const bearer = headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    const xtoken = headers.get("x-admin-token")
    if (bearer && constantTimeEqual(bearer, token)) return true
    if (xtoken && constantTimeEqual(xtoken, token)) return true
  }

  // Se è configurato un PIN d'istanza, verifica se la richiesta ha una sessione PIN valida
  if (hasPinConfiguredSync()) {
    return verifySessionFromRequestSync(request)
  }

  // Nessun token né PIN configurato → le route restano aperte solo in modalità
  // pubblica esplicita (PICTORIUM_PUBLIC_INSTANCE=1) o in dev su loopback /
  // con PICTORIUM_ALLOW_DEV_ADMIN=1. Il client non invia mai il token admin,
  // quindi la modalità pubblica è l'unico modo per far funzionare l'editor
  // su HF. Un'istanza di produzione privata che ha dimenticato il token
  // NON resta esposta → fail-closed.
  if (!token) {
    if (isPublicInstance()) return true
    if (isDevAdminAllowed(request)) return true
    return false
  }

  return false
}

/**
 * Fail-closed admin check: richiede SEMPRE un token admin configurato o un PIN di sessione valido.
 * A differenza di checkAdminToken (che resta aperto su istanze pubbliche senza
 * ADMIN_TOKEN), questa restituisce false quando non c'è token o PIN configurato.
 * Da usare SOLO per le operazioni che devono restare protette anche su HF Spaces
 * (es. DELETE /api/mappings wipe-all).
 */
export function requireAdminToken(request: Request): boolean {
  const token = resolveAdminToken()
  if (token) {
    const headers = request.headers
    const bearer = headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    const xtoken = headers.get("x-admin-token")
    if (bearer && constantTimeEqual(bearer, token)) return true
    if (xtoken && constantTimeEqual(xtoken, token)) return true
  }

  if (hasPinConfiguredSync()) {
    return verifySessionFromRequestSync(request)
  }

  return false
}

export function adminAuthResponse(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized. Set x-admin-token or Authorization: Bearer header." }), {
    status: 401,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  })
}

function hostnameOf(value: string | null): string | null {
  if (!value) return null
  // X-Forwarded-Host può essere una lista separata da virgole
  const first = value.split(",")[0].trim()
  try {
    return new URL(`https://${first}`).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** Allowlist opzionale di hostname pubblici ammessi (PICTORIUM_ALLOWED_HOSTS).
 *  Stessa logica di poster-public-url.ts: X-Forwarded-Host è fidato solo se
 *  combacia con l'header Host o se è in allowlist. */
function isAllowedHostname(hostname: string): boolean {
  const raw = envWithFallback("ALLOWED_HOSTS")
  if (!raw) return false
  const allowed = raw.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)
  return allowed.includes(hostname)
}

/**
 * CSRF guard per le mutazioni: se la richiesta include un header Origin
 * (i browser lo inviano sempre per POST/PUT/DELETE cross-origin), il suo
 * hostname deve combaciare con l'host pubblico della richiesta.
 * Le richieste senza Origin (curl, test, Stremio, tooling) passano.
 *
 * X-Forwarded-Host è fidato SOLO se combacia con l'header Host o è in
 * PICTORIUM_ALLOWED_HOSTS (fix H6, stessa logica di getOriginFromRequest):
 * XFH non è un header forbidden per i browser, quindi una pagina malevola
 * poteva inviare Origin: evil.com + X-Forwarded-Host: evil.com e superare il
 * controllo su ogni deploy senza proxy che sovrascrive XFH. XFH non fidato
 * → si ripiega sull'header Host / hostname della URL.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin")
  if (!origin) return true
  let originHost: string
  try {
    originHost = new URL(origin).hostname.toLowerCase()
  } catch {
    return false
  }
  const hostHeader = hostnameOf(request.headers.get("host"))
  const xfh = hostnameOf(request.headers.get("x-forwarded-host"))
  // Preferenza: X-Forwarded-Host (reverse proxy, solo se fidato) → Host →
  // hostname dell'URL della richiesta (fallback: NextRequest può non popolare
  // l'header Host).
  const host =
    (xfh && (xfh === hostHeader || isAllowedHostname(xfh)) ? xfh : null) ||
    hostHeader ||
    hostnameOf(new URL(request.url).hostname)
  // Fail-closed (finding 10): host irrisolvibile → rifiuta. Prima il fail-open
  // lasciava passare le richieste con Origin quando l'host non era derivabile.
  if (!host) return false
  return originHost === host
}

export function originMismatchResponse(): Response {
  return new Response(JSON.stringify({ error: "Cross-origin request rejected" }), {
    status: 403,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  })
}
