import { NextRequest } from "next/server"
import { getOriginFromRequest } from "@/lib/poster-public-url"
import { rewriteMetasPosters, rewriteSingleMetaPoster, proxyDefaultsSignature, type StremioItemMeta } from "@/lib/addon-proxy"
import { getServerDefaultsForUser } from "@/lib/server-defaults"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { createLogger } from "@/lib/logger"
import { envWithFallback } from "@/lib/env-compat"
import {
  BodyTooLargeError,
  hopSignal,
  readJsonCapped,
  redactUrlForLog,
  resolveAndCheckBlocked,
  safeFetchRemote,
  SafeFetchDeniedError,
} from "@/lib/safe-remote-fetch"

// Re-export per i consumer esistenti (test): l'implementazione vive in lib.
export { isIpv4Literal, isPrivateHost } from "@/lib/safe-remote-fetch"

const log = createLogger("addon-proxy")

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

// Deadline complessiva dell'intera operazione di proxy (fix H9): ogni hop ha
// il proprio timeout (10-12s), ma fino a 5 redirect × timeout + lettura body
// potevano superare il maxDuration della piattaforma, terminando la funzione a
// metà risposta. Un unico tetto globale avvolge safeFetch + readJsonCapped.
const PROXY_DEADLINE_MS = (() => {
  const raw = envWithFallback("PROXY_DEADLINE_MS")
  const n = raw ? parseInt(raw, 10) : 20000
  return Number.isFinite(n) && n >= 5000 && n <= 120000 ? n : 20000
})()

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    // Sempre JSON: i body proxati passano da readJsonCapped (JSON.parse) —
    // fare echo del Content-Type upstream (fix H9) permetterebbe a un addon
    // malevolo di servire text/html sulla nostra origin (XSS riflesso con
    // accesso al localStorage). nosniff chiude anche lo sniffing MIME.
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    // Le API sono fuori dal matcher CSP del middleware: la policy va messa
    // qui, per-risposta (i client JSON la ignorano, un HTML inatteso resta
    // inerte anche se qualcosa servisse mai text/html).
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Cache-Control": "no-cache, max-age=0, must-revalidate",
  }
}

/** Allowlist opzionale di domini proxy (PICTORIUM_PROXY_ALLOW_DOMAINS). */
export function isAllowedByAllowlist(url: URL): boolean {
  const raw = envWithFallback("PROXY_ALLOW_DOMAINS")
  if (!raw) return true
  const domains = raw.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean)
  if (domains.length === 0) return true
  const host = url.hostname.toLowerCase()
  return domains.some((d) => host === d || host.endsWith(`.${d}`))
}

/** Converte un rifiuto di policy del fetch sicuro negli stessi status/body della route. */
function safeFetchDeniedResponse(e: SafeFetchDeniedError): Response {
  if (e.reason === "allowlist") {
    return Response.json({ error: "Target domain not allowed" }, { status: 403, headers: corsHeaders() })
  }
  const body = e.reason === "redirect-target" ? "Redirect to blocked target" : "Too many redirects"
  return new Response(JSON.stringify({ error: body }), {
    status: 400,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  })
}

/** Esegue il fetch sicuro mappando i rifiuti di policy sulle risposte della route. */
async function proxySafeFetch(url: string, signal: AbortSignal): Promise<Response> {
  try {
    return await safeFetchRemote(url, { signal, isAllowedUrl: (u) => isAllowedByAllowlist(u) })
  } catch (e) {
    if (e instanceof SafeFetchDeniedError) return safeFetchDeniedResponse(e)
    throw e
  }
}

/**
 * Firma di cache-busting per i poster riscritti: gli URL proxy omettono tutti
 * i parametri visivi (li risolve la poster route da mapping > defaults),
 * quindi senza firma un cambio default lascerebbe URL identici e cache
 * stantie (Stremio/CDN). Copertura totale dei defaults via
 * `proxyDefaultsSignature` (stili + toggle + tuning): i param espliciti sono
 * esclusi di proposito — `bs=` dai defaults vincerebbe sul mapping
 * per-titolo (query > mapping) e clobbererebbe il lavoro salvato.
 * Fallback sicuro a null: niente `dv`, URL come prima.
 */
async function resolveProxyDv(userUuid: string | null): Promise<string | null> {
  try {
    const sd = await getServerDefaultsForUser(userUuid)
    return proxyDefaultsSignature(sd)
  } catch {
    return null
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const rl = await rateLimit(rateLimitKey(req), "default")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)

  const { path } = await params
  const origin = getOriginFromRequest(req)
  const searchParams = req.nextUrl.searchParams
  const rawTargetUrl = searchParams.get("target") || searchParams.get("url")
  const userUuid = searchParams.get("u") || searchParams.get("user") || null

  if (!rawTargetUrl) {
    return Response.json({ error: "Missing target URL parameter (?url= or ?target=)" }, { status: 400, headers: corsHeaders() })
  }

  let targetUrl = rawTargetUrl.trim()
  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
    targetUrl = `https://${targetUrl}`
  }

  if (await resolveAndCheckBlocked(targetUrl)) {
    log.warn("Blocked SSRF attempt", { target: redactUrlForLog(targetUrl) })
    return Response.json({ error: "Invalid target URL" }, { status: 400, headers: corsHeaders() })
  }

  const firstPath = path[0] || ""

  // 1. Manifest Proxy
  if (firstPath === "manifest") {
    const { signal, deadline } = hopSignal(10000, PROXY_DEADLINE_MS)
    try {
      const manifestRes = await proxySafeFetch(targetUrl, signal)
      if (!manifestRes.ok) {
        return Response.json({ error: `Failed to fetch target manifest: ${manifestRes.statusText}` }, { status: manifestRes.status, headers: corsHeaders() })
      }
      const origManifest = (await readJsonCapped(manifestRes, MAX_RESPONSE_BYTES)) as Record<string, unknown>
      const baseUrl = targetUrl.replace(/\/manifest\.json$/, "").replace(/\/$/, "")

      const userSuffix = userUuid ? `.${userUuid.slice(0, 8)}` : ""
      const proxiedManifest = {
        ...origManifest,
        id: `org.pictorium.proxy.${Buffer.from(baseUrl).toString("base64url").slice(0, 12)}${userSuffix}`,
        name: `${origManifest.name || "Addon"} (Pictorium)`,
        description: `${origManifest.description || ""} — Poster personalizzati via Pictorium`.trim(),
        logo: origManifest.logo || `${origin}/App.png`,
      }

      // Content-Type sempre JSON (corsHeaders): il body è comunque JSON
      // serializzato — l'echo dell'upstream aprirebbe a text/html malevolo.
      return Response.json(proxiedManifest, { headers: corsHeaders() })
    } catch (e) {
      log.error("Manifest proxy error", { error: e instanceof Error ? e.message : String(e) })
      if (deadline.aborted) {
        return Response.json({ error: "Proxy deadline exceeded" }, { status: 504, headers: corsHeaders() })
      }
      if (e instanceof BodyTooLargeError) {
        return Response.json({ error: "Target manifest too large" }, { status: 413, headers: corsHeaders() })
      }
      return Response.json({ error: "Error fetching manifest" }, { status: 500, headers: corsHeaders() })
    }
  }

  // 2. Resource Proxy (catalog, meta, etc.)
  // Il proxy è pensato per addon Stremio: accetta solo i path standard degli
  // addon, non qualunque percorso del target. Questo evita che l'istanza sia
  // usata come proxy HTTP generico / open relay per URL arbitrari.
  const RESOURCE_PREFIXES = new Set(["catalog", "meta", "stream", "subtitles", "search"])
  if (!RESOURCE_PREFIXES.has(firstPath)) {
    log.warn("Blocked non-addon proxy path", { path: firstPath })
    return Response.json({ error: "Invalid proxy resource path" }, { status: 400, headers: corsHeaders() })
  }
  let deadline: AbortSignal | null = null
  try {
    const subPath = path.join("/")
    const targetBase = targetUrl.replace(/\/manifest\.json$/, "").replace(/\/$/, "")
    // Inoltra i query param originali della richiesta (genre/skip/type/id/...):
    // senza, i cataloghi/meta proxati perdono filtro e paginazione (finding 3).
    // Esclusi i parametri di controllo del proxy stesso e le chiavi API
    // (fix M6): la chiave TMDB/MDBList dell'utente non deve finire sul server
    // dell'addon proxyato.
    const STRIPPED_PARAMS = new Set(["target", "url", "u", "user", "api_key", "apikey", "x-api-key", "mdblist_key"])
    const targetQuery = new URLSearchParams()
    for (const [k, v] of searchParams) {
      if (STRIPPED_PARAMS.has(k.toLowerCase())) continue
      targetQuery.append(k, v)
    }
    const qs = targetQuery.toString()
    const fullTargetUrl = `${targetBase}/${subPath}${qs ? `?${qs}` : ""}`
    const { signal, deadline: d } = hopSignal(12000, PROXY_DEADLINE_MS)
    deadline = d
    const res = await proxySafeFetch(fullTargetUrl, signal)
    if (!res.ok) {
      return Response.json({ error: `Failed to fetch proxy resource: ${res.statusText}` }, { status: res.status, headers: corsHeaders() })
    }

    const data = (await readJsonCapped(res, MAX_RESPONSE_BYTES)) as Record<string, unknown> & { metas?: StremioItemMeta[]; meta?: StremioItemMeta }

    if (data && Array.isArray(data.metas)) {
      data.metas = rewriteMetasPosters(data.metas as StremioItemMeta[], origin, userUuid, await resolveProxyDv(userUuid))
    } else if (data && data.meta) {
      data.meta = rewriteSingleMetaPoster(data.meta as StremioItemMeta, origin, userUuid, await resolveProxyDv(userUuid))
    }

    // Content-Type sempre JSON (corsHeaders): `data` è JSON parsato e
    // ri-serializzato — l'echo dell'upstream (ex fix H9) servirebbe text/html
    // malevolo sulla nostra origin.
    return Response.json(data, { headers: corsHeaders() })
  } catch (e) {
    log.error("Resource proxy error", { error: e instanceof Error ? e.message : String(e) })
    if (deadline && deadline.aborted) {
      return Response.json({ error: "Proxy deadline exceeded" }, { status: 504, headers: corsHeaders() })
    }
    if (e instanceof BodyTooLargeError) {
      return Response.json({ error: "Proxy resource too large" }, { status: 413, headers: corsHeaders() })
    }
    return Response.json({ error: "Proxy resource error" }, { status: 500, headers: corsHeaders() })
  }
}
