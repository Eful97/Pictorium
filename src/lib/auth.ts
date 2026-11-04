import crypto from "node:crypto"
import { createLogger } from "@/lib/logger"
import { envWithFallback } from "@/lib/env-compat"
import { extractSessionToken, hasPinConfigured, verifySessionFromRequest } from "@/lib/pin-auth"

const log = createLogger("auth")

/** Una variabile definita ma vuota (o di soli spazi) non vale come configurata:
 *  docker-compose materializza `PICTORIUM_ADMIN_TOKEN=""`, che senza questo
 *  controllo oscurerebbe un `POSTERIUM_ADMIN_TOKEN` legacy realmente impostato.
 *  Il valore non viene trimmato: il confronto resta sul testo configurato. */
function nonEmptyToken(value: string | undefined): string | undefined {
  return value && value.trim() ? value : undefined
}

function resolveAdminToken(): string | undefined {
  // Prima non-vuota vince: canonico → legacy (warning di deprecazione invariato
  // via envWithFallback) → ADMIN_TOKEN nudo.
  return (
    nonEmptyToken(envWithFallback("ADMIN_TOKEN")) ??
    nonEmptyToken(process.env.POSTERIUM_ADMIN_TOKEN) ??
    nonEmptyToken(process.env.ADMIN_TOKEN)
  )
}

// F7 (dev-only): trust ONLY the request URL hostname. The Host header is
// client-controllable and must not grant loopback privileges (e.g. a
// non-loopback URL with Host: localhost). ALLOW_DEV_ADMIN=1 still opens dev.
function isLoopbackRequest(request: Request): boolean {
  try {
    const hostname = new URL(request.url).hostname.toLowerCase()
    return hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost"
  } catch {
    return false
  }
}

function isDevAdminAllowed(request: Request): boolean {
  if (process.env.NODE_ENV !== "development") return false
  if (envWithFallback("ALLOW_DEV_ADMIN") === "1") return true
  return isLoopbackRequest(request)
}

// Boot diagnostics (solo log, nessun comportamento): le route admin sono
// APERTE senza token solo in dev locale (loopback o ALLOW_DEV_ADMIN=1) o con
// una sessione PIN valida. In produzione senza ADMIN_TOKEN restano CHIUSE
// (fail-closed): la vecchia modalità "istanza pubblica" non esiste più.
if (!resolveAdminToken()) {
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
    log.warn("⚠️  Nessun ADMIN_TOKEN configurato — route admin CHIUSE (fail-closed).")
    log.warn("   - Istanza privata: imposta PICTORIUM_ADMIN_TOKEN (o ADMIN_TOKEN) (x-admin-token / Bearer)")
  }
}

/** True quando un ADMIN_TOKEN è configurato (qualunque env supportata). */
export function hasAdminTokenConfigured(): boolean {
  return !!resolveAdminToken()
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export async function checkAdminToken(request: Request): Promise<boolean> {
  const token = resolveAdminToken()
  if (token) {
    const headers = request.headers
    const bearer = headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    const xtoken = headers.get("x-admin-token")
    if (bearer && constantTimeEqual(bearer, token)) return true
    if (xtoken && constantTimeEqual(xtoken, token)) return true
  }

  // Hot path: senza credenziale di sessione nessuna sessione PIN è possibile
  // (produzione → zero I/O KV). In development la config va comunque letta:
  // un PIN configurato deve continuare a oscurare il bypass loopback.
  const sessionToken = extractSessionToken(request)
  if (sessionToken || process.env.NODE_ENV === "development") {
    if (await hasPinConfigured()) return verifySessionFromRequest(request)
  }

  // Nessun token né PIN configurato → le route restano aperte solo in dev
  // locale su loopback / con PICTORIUM_ALLOW_DEV_ADMIN=1. Il client non invia
  // mai il token admin: un'istanza di produzione privata che ha dimenticato il
  // token NON resta esposta → fail-closed (nessuna modalità "pubblica").
  if (!token) {
    if (isDevAdminAllowed(request)) return true
    return false
  }

  return false
}

/**
 * Fail-closed admin check: richiede SEMPRE un token admin configurato o un PIN di sessione valido.
 * A differenza di checkAdminToken (che resta aperto solo in dev locale senza
 * token), questa restituisce false quando non c'è token o PIN configurato.
 * Da usare SOLO per le operazioni che devono restare protette anche sui deploy
 * condivisi (es. DELETE /api/mappings wipe-all, telemetria cache).
 */
export async function requireAdminToken(request: Request): Promise<boolean> {
  const token = resolveAdminToken()
  if (token) {
    const headers = request.headers
    const bearer = headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    const xtoken = headers.get("x-admin-token")
    if (bearer && constantTimeEqual(bearer, token)) return true
    if (xtoken && constantTimeEqual(xtoken, token)) return true
  }

  // Senza credenziale di sessione nessuna sessione PIN è possibile: salta la
  // lettura KV sull'hot path (poster) invece di interrogare la config a freddo.
  if (extractSessionToken(request) && (await hasPinConfigured())) {
    return verifySessionFromRequest(request)
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
