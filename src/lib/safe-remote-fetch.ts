import dns, { type LookupOptions } from "node:dns"
import { createLogger } from "@/lib/logger"

const log = createLogger("safe-remote-fetch")

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
      /^169\.254\./.test(h) ||                     // link-local
      /^100\.(6[4-9]|[78]\d|9\d|1[01]\d|12[0-7])\./.test(h) || // CGNAT 100.64.0.0/10 (v1.23.0)
      /^198\.(18|19)\./.test(h) ||                 // benchmarking 198.18.0.0/15 (v1.23.0)
      h.startsWith("192.0.2.") ||                  // TEST-NET-1 (v1.23.0)
      h.startsWith("198.51.100.") ||               // TEST-NET-2 (v1.23.0)
      h.startsWith("203.0.113.")                   // TEST-NET-3 (v1.23.0)
    )
  }

  // Nome DNS: mai bloccato dal testo, sarà valutato sugli IP risolti.
  return false
}

/** Verifica se un indirizzo IP risolto (IPv4 o IPv6) è privato/non routabile. */
export function isPrivateIp(address: string): boolean {
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
export async function resolveAndCheckBlocked(url: string): Promise<boolean> {
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

/** Solo per test: resetta il lazy-load della coppia fetch/dispatcher. */
export function resetSafeFetchForTests(): void {
  safePair = undefined
  safePairTried = false
}

export function redactUrlForLog(urlStr: string): string {
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

export class BodyTooLargeError extends Error {}

/** Legge il body applicando un cap sulla dimensione (anti-mem-exhaustion). */
export async function readBodyCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = res.headers.get("content-length")
  if (declared && Number(declared) > maxBytes) {
    throw new BodyTooLargeError(`Response exceeds ${maxBytes} bytes`)
  }
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > maxBytes) throw new BodyTooLargeError(`Response exceeds ${maxBytes} bytes`)
    return buf
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new BodyTooLargeError(`Response exceeds ${maxBytes} bytes`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

/** Legge il body JSON applicando un cap sulla dimensione (anti-mem-exhaustion). */
export async function readJsonCapped(res: Response, maxBytes: number): Promise<unknown> {
  const buf = await readBodyCapped(res, maxBytes)
  return JSON.parse(buf.toString("utf-8"))
}

/**
 * Signal di un singolo hop: il timeout specifico dell'hop E la deadline
 * complessiva dell'operazione. Il primo hop non può superare i suoi secondi,
 * ma la somma di tutti gli hop + lettura body non può superare deadlineMs:
 * un'abort della deadline propaga come AbortError.
 */
export function hopSignal(hopTimeoutMs: number, deadlineMs: number): { signal: AbortSignal; deadline: AbortSignal } {
  const deadline = AbortSignal.timeout(deadlineMs)
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

export type SafeFetchDeniedReason = "allowlist" | "redirect-target" | "too-many-redirects"

/** Il fetch è stato rifiutato per policy (non per errore di rete). */
export class SafeFetchDeniedError extends Error {
  readonly reason: SafeFetchDeniedReason
  constructor(reason: SafeFetchDeniedReason, message: string) {
    super(message)
    this.reason = reason
  }
}

export interface SafeFetchOptions {
  /** Signal già combinato (hop timeout + deadline) dal chiamante. */
  signal: AbortSignal
  /** Predicato opzionale di allowlist, valutato su OGNI hop (incluso il primo). */
  isAllowedUrl?: (url: URL) => boolean
  maxRedirects?: number
  /** Header extra (merge sopra i default). */
  headers?: Record<string, string>
}

/**
 * UA browser di default: diversi CDN/WAF (es. i.pinimg.com) rispondono 403
 * agli UA bot/undici, mentre servono i browser. Senza, il server non riesce
 * a scaricare byte che il browser carica senza problemi (thumb ok, render
 * 404). Vale per tutti i consumer: anche i manifest upstream beneficiano
 * dell'UA browser (massima compatibilità).
 */
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

/**
 * Esegue un fetch con redirect manuali, validando ogni destinazione.
 * Previene SSRF via redirect 302 verso IP privati. Il DNS pin (coppia
 * fetch/dispatcher undici) garantisce che ogni connessione usi solo indirizzi
 * pubblici verificati. A differenza della vecchia versione privata alla route
 * proxy, i rifiuti di policy lanciano SafeFetchDeniedError invece di
 * costruire Response: la conversione in status HTTP spetta al chiamante.
 */
export async function safeFetchRemote(
  url: string,
  options: SafeFetchOptions,
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 5
  let currentUrl = url
  let redirectCount = 0
  while (redirectCount <= maxRedirects) {
    if (options.isAllowedUrl && !options.isAllowedUrl(new URL(currentUrl))) {
      log.warn("Blocked by allowlist", { target: redactUrlForLog(currentUrl) })
      throw new SafeFetchDeniedError("allowlist", "Target domain not allowed")
    }
    // fetchFn e dispatcher provengono dallo stesso modulo undici (vedi
    // getSafeFetch): mescolare l'Agent npm con la fetch globale di Node
    // rompe ogni richiesta (`invalid onRequestStart method`). Se undici non è
    // caricabile si usa la fetch globale senza dispatcher +
    // resolveAndCheckBlocked già fatto sopra.
    const safe = await getSafeFetch()
    const fetchFn = safe?.fetchFn ?? fetch
    const fetchOpts = {
      signal: options.signal,
      redirect: "manual",
      headers: { "User-Agent": DEFAULT_UA, Accept: "*/*", ...options.headers },
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
      throw new SafeFetchDeniedError("redirect-target", "Redirect to blocked target")
    }
    currentUrl = targetUrl
    redirectCount++
  }
  throw new SafeFetchDeniedError("too-many-redirects", "Too many redirects")
}
