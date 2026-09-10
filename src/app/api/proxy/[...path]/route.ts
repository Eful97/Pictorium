import dns, { type LookupOptions } from "node:dns"
import { NextRequest } from "next/server"
import { getOriginFromRequest } from "@/lib/poster-public-url"
import { rewriteMetasPosters, rewriteSingleMetaPoster, type StremioItemMeta } from "@/lib/addon-proxy"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { createLogger } from "@/lib/logger"
import { envWithFallback } from "@/lib/env-compat"

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

class ProxyBodyTooLargeError extends Error {}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache, max-age=0, must-revalidate",
  }
}

function redactUrlForLog(urlStr: string): string {
  try {
    const u = new URL(urlStr)
    if (u.searchParams.has("api_key")) u.searchParams.set("api_key", "[REDACTED]")
    if (u.searchParams.has("apikey")) u.searchParams.set("apikey", "[REDACTED]")
    if (u.searchParams.has("key")) u.searchParams.set("key", "[REDACTED]")
    return u.toString()
  } catch {
    return urlStr
  }
}

/** Un hostname è un letterale IPv4 (es. 10.0.0.1) e non un nome DNS. */
export function isIpv4Literal(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
}

/** Blocca richieste a IP privati / localhost per prevenire SSRF.
 *
 * Importante: i check sui prefissi IP (RFC 1918, fc00::/7, fe80::/10, …) si
 * applicano SOLO ai letterali IP. Un nome DNS come "fcbarcelona.com" non deve
 * essere bloccato solo perché inizia con "fc": per i nomi DNS la protezione
 * arriva dal resolve (resolveAndCheckBlocked/isPrivateIp sugli indirizzi
 * risolti), non da un match di prefisso sul testo.
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === "localhost") return true
  if (h.endsWith(".local") || h.endsWith(".internal")) return true

  // Letterale IPv6 — rimuovi le parentesi per un match uniforme.
  if (h.includes(":")) {
    const bare = h.replace(/^\[|\]$/g, "")
    return (
      bare === "::1" || bare === "::" ||           // loopback / unspecified
      bare.startsWith("::ffff:") ||                // IPv4-mapped IPv6
      bare.startsWith("fc") || bare.startsWith("fd") ||  // fc00::/7 ULA
      /^fe[89ab]/.test(bare)                       // fe80::/10 link-local
    )
  }

  // Letterale IPv4 — i check RFC 1918 / link-local valgono solo qui.
  if (isIpv4Literal(h)) {
    return (
      /^127\./.test(h) ||                          // loopback 127.0.0.0/8
      h === "0.0.0.0" ||
      h.startsWith("10.") ||                       // RFC 1918 10.0.0.0/8
      h.startsWith("192.168.") ||                  // RFC 1918 192.168.0.0/16
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||      // RFC 1918 172.16.0.0/12
      /^169\.254\./.test(h)                        // link-local
    )
  }

  // Nome DNS: mai bloccato dal testo, sarà valutato sugli IP risolti.
  return false
}

/** Verifica se un indirizzo IP risolto (IPv4 o IPv6) è privato/non routabile. */
function isPrivateIp(address: string): boolean {
  const lower = address.toLowerCase()
  if (lower === "::1" || lower === "::" || lower === "[::1]" || lower === "[::]") return true
  if (lower.startsWith("::ffff:") || lower.startsWith("0:0:0:0:0:ffff:")) {
    // IPv4-mapped IPv6: estrai il quad e valutalo come IPv4
    const v4 = lower.split(":").pop() || ""
    if (isPrivateHost(v4)) return true
    return /^127\./.test(v4) || v4 === "0.0.0.0"
  }
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true // ULA fc00::/7
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true // link-local
  if (isPrivateHost(lower)) return true
  return false
}


/**
 * Risolve un hostname a IP (entrambe le famiglie) e verifica che nessuno sia privato.
 * Protegge da:
 * - DNS rebinding (il controllo viene fatto dopo la risoluzione DNS)
 * - IP alternativi (decimali, hex, IPv4-mapped IPv6)
 * - Hostname locali
 * - IPv6 (fetch/undici usa Happy Eyeballs: può connettersi via AAAA anche se il check
 *   considera solo A — quindi dobbiamo bloccare se QUALSIASI indirizzo risolto è privato)
 */
async function resolveAndCheckBlocked(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()
    // Controllo rapido su hostname prima di risolvere
    if (isPrivateHost(hostname)) return true
    // Risolvi a IP per prevenire bypass con rappresentazioni alternative.
    // family 0 + all: tutte le family, tutti gli IP. Blocca se uno qualsiasi è privato.
    const addresses = await dns.promises.lookup(hostname, { family: 0, all: true })
    for (const entry of addresses) {
      if (isPrivateIp(entry.address)) return true
    }
    return false
  } catch {
    return true // in caso di errore DNS, blocca per sicurezza
  }
}

/**
 * Lookup DNS personalizzato per l'Agent undici: risolve il hostname e restituisce
 * SOLO gli indirizzi pubblici. Chiude il TOCTOU di resolveAndCheckBlocked: la
 * connessione avviene esattamente sugli IP verificati, senza finestra di
 * DNS-rebinding tra check e fetch. Se nessun indirizzo è pubblico → errore.
 */
function safeLookup(hostname: string, options: LookupOptions, callback: (err: NodeJS.ErrnoException | null, address: dns.LookupAddress[] | string, family?: number) => void) {
  dns.promises
    .lookup(hostname, { family: 0, all: true })
    .then((addresses) => {
      const safe = addresses.filter((a) => !isPrivateIp(a.address))
      if (safe.length === 0) {
        callback(new Error(`Blocked SSRF: no public IP for ${hostname}`), [])
        return
      }
      if (options.all) {
        callback(null, safe)
      } else {
        callback(null, safe[0].address, safe[0].family)
      }
    })
    .catch((err: NodeJS.ErrnoException) => callback(err, []))
}

/** Fetch + Agent undici caricati dalla STESSA istanza (DNS pin) — lazy per non
 * rompere la build su Node 20 (undici 8 richiede >=22.19: markAsUncloneable).
 *
 * Il dispatcher DEVE appartenere alla stessa implementazione undici della
 * fetch usata: passare un Agent del pacchetto npm `undici` alla fetch globale
 * di Node (undici interno di versione diversa) fallisce ogni richiesta con
 * `invalid onRequestStart method` → 500 su tutto il proxy. Per questo la
 * coppia fetch/dispatcher viene presa dallo stesso modulo dinamico; se il
 * modulo non è caricabile si degrada alla fetch globale senza dispatcher
 * (resta comunque il pre-check DNS di resolveAndCheckBlocked).
 */
type SafeFetchPair = {
  fetchFn: typeof fetch
  dispatcher: InstanceType<typeof import("undici").Agent>
}
let safePair: SafeFetchPair | undefined
let safePairTried = false
async function getSafeFetch(): Promise<SafeFetchPair | undefined> {
  if (safePairTried) return safePair
  safePairTried = true
  try {
    const { Agent, fetch: undiciFetch } = await import("undici") as typeof import("undici")
    safePair = {
      fetchFn: undiciFetch as unknown as typeof fetch,
      dispatcher: new Agent({ connect: { lookup: safeLookup } }),
    }
  } catch (e) {
    log.warn("undici unavailable — DNS pin disabilitato, fallback a fetch senza dispatcher", {
      error: e instanceof Error ? e.message : String(e),
    })
    safePair = undefined
  }
  return safePair
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

/** Legge il body JSON applicando un cap sulla dimensione (anti-mem-exhaustion). */
async function readJsonCapped(res: Response): Promise<unknown> {
  const declared = res.headers.get("content-length")
  if (declared && Number(declared) > MAX_RESPONSE_BYTES) {
    throw new ProxyBodyTooLargeError(`Response exceeds ${MAX_RESPONSE_BYTES} bytes`)
  }
  if (!res.body) return res.json()
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {})
      throw new ProxyBodyTooLargeError(`Response exceeds ${MAX_RESPONSE_BYTES} bytes`)
    }
    chunks.push(value)
  }
  const buf = Buffer.concat(chunks)
  return JSON.parse(buf.toString("utf-8"))
}

/**
 * Signal di un singolo hop: il timeout specifico dell'hop E la deadline
 * complessiva del proxy (H9). Il primo hop non può superare i suoi 10-12s,
 * ma la somma di tutti gli hop + lettura body non può superare
 * PROXY_DEADLINE_MS: un'abort della deadline propaga come AbortError.
 */
function hopSignal(hopTimeoutMs: number): { signal: AbortSignal; deadline: AbortSignal } {
  const deadline = AbortSignal.timeout(PROXY_DEADLINE_MS)
  const hopTimeout = AbortSignal.timeout(hopTimeoutMs)
  let signal: AbortSignal
  if (typeof (AbortSignal as unknown as { any?: unknown }).any === "function") {
    signal = (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any([deadline, hopTimeout])
  } else {
    const ctrl = new AbortController()
    const onAbort = () => ctrl.abort()
    if (deadline.aborted || hopTimeout.aborted) ctrl.abort()
    else {
      deadline.addEventListener("abort", onAbort, { once: true })
      hopTimeout.addEventListener("abort", onAbort, { once: true })
    }
    signal = ctrl.signal
  }
  return { deadline, signal }
}

/**
 * Esegue un fetch con redirect manuali, validando ogni destinazione.
 * Previene SSRF via redirect 302 verso IP privati. Il DNS pin (coppia
 * fetch/dispatcher undici di getSafeFetch) garantisce che ogni connessione
 * usi solo indirizzi pubblici verificati.
 */
async function safeFetch(url: string, options: RequestInit & { signal: AbortSignal }): Promise<Response> {
  let currentUrl = url
  let redirectCount = 0
  const MAX_REDIRECTS = 5
  while (redirectCount <= MAX_REDIRECTS) {
    if (!isAllowedByAllowlist(new URL(currentUrl))) {
      log.warn("Blocked by proxy allowlist", { target: redactUrlForLog(currentUrl) })
      return Response.json({ error: "Target domain not allowed" }, { status: 403, headers: corsHeaders() })
    }
    // fetchFn e dispatcher provengono dallo stesso modulo undici (vedi
    // getSafeFetch): mescolare l'Agent npm con la fetch globale di Node
    // rompe ogni richiesta (`invalid onRequestStart method`). Se undici non è
    // caricabile si usa la fetch globale senza dispatcher +
    // resolveAndCheckBlocked già fatto sopra.
    const safe = await getSafeFetch()
    const fetchFn = safe?.fetchFn ?? fetch
    const fetchOpts = {
      ...options,
      redirect: "manual",
      ...(safe ? { dispatcher: safe.dispatcher } : {}),
    } as unknown as RequestInit
    const res = await fetchFn(currentUrl, fetchOpts)
    if (res.status < 300 || res.status >= 400) return res
    // Redirect — validiamo la destinazione
    const location = res.headers.get("location")
    if (!location) return res
    const targetUrl = new URL(location, currentUrl).href
    if (await resolveAndCheckBlocked(targetUrl)) {
      log.warn("Blocked SSRF redirect", { from: redactUrlForLog(currentUrl), to: redactUrlForLog(targetUrl) })
      return new Response(JSON.stringify({ error: "Redirect to blocked target" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      })
    }
    currentUrl = targetUrl
    redirectCount++
  }
  return new Response(JSON.stringify({ error: "Too many redirects" }), {
    status: 400,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  })
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
    const { signal, deadline } = hopSignal(10000)
    try {
      const manifestRes = await safeFetch(targetUrl, { signal })
      if (!manifestRes.ok) {
        return Response.json({ error: `Failed to fetch target manifest: ${manifestRes.statusText}` }, { status: manifestRes.status, headers: corsHeaders() })
      }
      const origManifest = (await readJsonCapped(manifestRes)) as Record<string, unknown>
      const baseUrl = targetUrl.replace(/\/manifest\.json$/, "").replace(/\/$/, "")

      const userSuffix = userUuid ? `.${userUuid.slice(0, 8)}` : ""
      const proxiedManifest = {
        ...origManifest,
        id: `org.pictorium.proxy.${Buffer.from(baseUrl).toString("base64url").slice(0, 12)}${userSuffix}`,
        name: `${origManifest.name || "Addon"} (Pictorium)`,
        description: `${origManifest.description || ""} — Poster personalizzati via Pictorium`.trim(),
        logo: origManifest.logo || `${origin}/App.png`,
      }

      // Echo del Content-Type upstream: il manifest può essere servito da
      // addon con media type diversi dal JSON "puro" (fix H9).
      return Response.json(proxiedManifest, { headers: { ...corsHeaders(), "Content-Type": manifestRes.headers.get("content-type") || "application/json; charset=utf-8" } })
    } catch (e) {
      log.error("Manifest proxy error", { error: e instanceof Error ? e.message : String(e) })
      if (deadline.aborted) {
        return Response.json({ error: "Proxy deadline exceeded" }, { status: 504, headers: corsHeaders() })
      }
      if (e instanceof ProxyBodyTooLargeError) {
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
    const { signal, deadline: d } = hopSignal(12000)
    deadline = d
    const res = await safeFetch(fullTargetUrl, { signal })
    if (!res.ok) {
      return Response.json({ error: `Failed to fetch proxy resource: ${res.statusText}` }, { status: res.status, headers: corsHeaders() })
    }

    const data = (await readJsonCapped(res)) as Record<string, unknown> & { metas?: StremioItemMeta[]; meta?: StremioItemMeta }

    if (data && Array.isArray(data.metas)) {
      data.metas = rewriteMetasPosters(data.metas as StremioItemMeta[], origin, userUuid)
    } else if (data && data.meta) {
      data.meta = rewriteSingleMetaPoster(data.meta as StremioItemMeta, origin, userUuid)
    }

    // Echo del Content-Type upstream invece di forzare JSON (fix H9): addon
    // stream/metadata possono rispondere con altri media type (es. M3U8).
    return Response.json(data, { headers: { ...corsHeaders(), "Content-Type": res.headers.get("content-type") || "application/json; charset=utf-8" } })
  } catch (e) {
    log.error("Resource proxy error", { error: e instanceof Error ? e.message : String(e) })
    if (deadline && deadline.aborted) {
      return Response.json({ error: "Proxy deadline exceeded" }, { status: 504, headers: corsHeaders() })
    }
    if (e instanceof ProxyBodyTooLargeError) {
      return Response.json({ error: "Proxy resource too large" }, { status: 413, headers: corsHeaders() })
    }
    return Response.json({ error: "Proxy resource error" }, { status: 500, headers: corsHeaders() })
  }
}
