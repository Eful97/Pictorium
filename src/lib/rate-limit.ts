const buckets = new Map<string, { tokens: number; lastRefill: number }>()
const CLEANUP_INTERVAL = 30 * 60 * 1000
// Cap sul numero di bucket: gli IP spoofati (X-Forwarded-For senza proxy
// trusted) possono generare chiavi arbitrarie. Oltre il cap, i bucket più
// vecchi vengono rimossi (FIFO) per tenere la memoria bounded.
const MAX_KEYS = 50_000
let cleanupTimer: ReturnType<typeof setInterval> | null = null
import { createLogger } from "@/lib/logger"
import { envWithFallback } from "@/lib/env-compat"
import { getKv, getStorageMode } from "@/lib/kv"

const log = createLogger("rate-limit")

function evictOldest() {
  const oldest = buckets.keys().next().value
  if (oldest !== undefined) buckets.delete(oldest)
}

function startCleanup() {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - CLEANUP_INTERVAL
    for (const [key, b] of buckets) {
      if (b.lastRefill < cutoff) buckets.delete(key)
    }
  }, CLEANUP_INTERVAL)
}

interface BucketConfig {
  maxTokens: number
  refillRate: number
  refillWindow: number
}

// F7: il bucket poster era 100 burst/10s — un catalog load con molti poster
// freddi poteva andare in 429. Sovrascrivibile via env a module level.
const POSTER_MAX_TOKENS = (() => {
  const raw = envWithFallback("RATELIMIT_POSTER_MAX")
  const n = raw ? parseInt(raw, 10) : 200
  return Number.isFinite(n) && n >= 10 && n <= 10000 ? n : 200
})()

const limits: Record<string, BucketConfig> = {
  default: { maxTokens: 120, refillRate: 10, refillWindow: 1000 },
  tmdb:    { maxTokens: 60,  refillRate: 5,  refillWindow: 1000 },
  poster:  { maxTokens: POSTER_MAX_TOKENS, refillRate: 20, refillWindow: 1000 },
  search:  { maxTokens: 30,  refillRate: 3,  refillWindow: 1000 },
  mappings: { maxTokens: 120, refillRate: 10, refillWindow: 1000 },
  // Resolve-image: oracolo di fetch su host esterni — burst contenuto e
  // refill lento. La legittima UI ne fa uno per click su "Test".
  "resolve-image": { maxTokens: 10, refillRate: 1, refillWindow: 6000 },
  presets:  { maxTokens: 120, refillRate: 10, refillWindow: 1000 },
  catalog:  { maxTokens: 60,  refillRate: 5,  refillWindow: 1000 },
  // Warmup: operazione pesante (rende molti poster) — burst basso e refill lento
  // per evitare che chiunque (istanza pubblica) possa triggerare carico.
  warmup:   { maxTokens: 5,  refillRate: 1,  refillWindow: 1000 },
  // Config token: generazione di link firmati — burst contenuto per evitare
  // che l'endpoint venga usato come generatore massivo.
  config:   { maxTokens: 30, refillRate: 3,  refillWindow: 1000 },
  defaults: { maxTokens: 30, refillRate: 3,  refillWindow: 1000 },
  // Validate-key: oracolo di validità per chiavi rubate — burst contenuto e
  // ~5/min sostenuti (1 token ogni 12s). La legittima UI ne fa una manciata.
  "validate-key": { maxTokens: 10, refillRate: 1,  refillWindow: 12000 },
  // Fanart.tv: la UI ne fa una per apertura sezione a titolo (lazy) — burst
  // contenuto come tmdb, refill uguale. La quota Fanart è stretta: la cache
  // 24h/10min della route assorbe i ricaricamenti.
  fanart:   { maxTokens: 60,  refillRate: 5,  refillWindow: 1000 },
  // TVDB artworks gallery: la UI ne fa una per apertura sezione a titolo
  // (lazy, come Fanart) — stessi burst/refill. La cache 6h/10min della route
  // assorbe i ricaricamenti; la quota TVDB resta protetta dal breaker.
  tvdb:      { maxTokens: 60,  refillRate: 5,  refillWindow: 1000 },
  // Streaming availability index (`GET /api/streaming-availability`): read-only
  // discovery over a cached index, called by the "Add Top 10" dialog. It has no
  // own bucket entry, so it silently fell back to `default` (120 burst): a
  // tight burst + slow refill keeps the index endpoint from being used as a
  // free enumeration oracle while a real operator session stays comfortable.
  availability: { maxTokens: 30, refillRate: 3, refillWindow: 1000 },
  // PIN auth: tentativi di brute-force su 4-8 cifre — burst contenuto e
  // refill lento (20 burst, ~2/s sostenuti). La protezione reale viene da
  // PIN min 6 cifre + rotazione sessionSecret a ogni setPin.
  "auth-pin": { maxTokens: 20, refillRate: 2, refillWindow: 1000 },
  // Creazione utenti (multi-user): istanza aperta a chiunque — burst stretto
  // e refill lento contro lo spam di UUID. Vale anche per GET exists (oracle).
  "users-create": { maxTokens: 5, refillRate: 1, refillWindow: 60000 },
  // Password utenti (verify + cambio): scrypt è costoso e le password hanno
  // poca entropia — burst contenuto e refill lento anti brute-force, su
  // chiave composita IP+UUID (vedi userRateLimitKey).
  "users-password": { maxTokens: 10, refillRate: 1, refillWindow: 60000 },
}

function memoryRateLimit(bucketKey: string, cfg: BucketConfig, now: number): { ok: boolean; retAfter: number } {
  startCleanup()
  let b = buckets.get(bucketKey)

  if (!b) {
    if (buckets.size >= MAX_KEYS) evictOldest()
    b = { tokens: cfg.maxTokens, lastRefill: now }
    buckets.set(bucketKey, b)
  }

  const elapsed = now - b.lastRefill
  if (elapsed >= cfg.refillWindow) {
    const cycles = Math.floor(elapsed / cfg.refillWindow)
    const refill = cycles * cfg.refillRate
    b.tokens = Math.min(b.tokens + refill, cfg.maxTokens)
    b.lastRefill += cycles * cfg.refillWindow
  }

  if (b.tokens > 0) {
    b.tokens--
    return { ok: true, retAfter: 0 }
  }

  const waitMs = b.lastRefill + cfg.refillWindow - now
  return { ok: false, retAfter: Math.ceil(waitMs / 1000) }
}

// ---- Store distribuito (opzionale) ----
// Con KV configurato (Redis nativo o Upstash / Vercel KV via `lib/kv.ts`)
// il rate-limit usa un contatore fixed-window condiviso su Redis: su deploy
// multi-istanza (Vercel multi-lambda, HF multi-replica) il limite in-memory
// per-process vale comunque N × maxTokens per istanza. La finestra è
// `refillWindow` (1s) con cap `maxTokens` per finestra — approssimazione
// del token bucket locale.
// PICTORIUM_RATELIMIT_KV=0 (legacy: POSTERIUM_RATELIMIT_KV=0) forza lo store in-memory anche con KV presente.
// Su errore KV si degrada al bucket in-memory di questo processo (fail-open
// locale): un outage del rate-limit non deve mai rompere il serving.
// Lettura live (mai a module level): i test mutano le env + resetModules.
function isKvStore(): boolean {
  return getStorageMode() === "kv" && envWithFallback("RATELIMIT_KV") !== "0"
}

let lastKvErrorLog = 0

function logKvFallback(error: unknown): void {
  const now = Date.now()
  // Log throttled: in outage il fallback gira su ogni richiesta.
  if (now - lastKvErrorLog < 60_000) return
  lastKvErrorLog = now
  log.warn("KV rate-limit store unavailable — falling back to per-process bucket", {
    error: error instanceof Error ? error.message : String(error),
  })
}

// Token bucket Lua atomico: replica il ramo in-memory (refill per cicli,
// cap a maxTokens, decremento, retAfter) in un solo round-trip EVAL, senza
// INCR+EXPIRE separati (niente chiave orfana su crash). Lo store è un hash
// `rl:<bucketKey>` con campi `tokens`/`lastRefill`; TTL 30 min come il cleanup
// in-memory (i bucket inattivi scadono da soli).
const KV_BUCKET_TTL_SEC = 30 * 60
const KV_TOKEN_BUCKET_SCRIPT = `
local key = KEYS[1]
local maxTokens = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local refillWindow = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local ttlSec = tonumber(ARGV[5])
local tokens = redis.call('HGET', key, 'tokens')
local lastRefill = redis.call('HGET', key, 'lastRefill')
if tokens == false then tokens = maxTokens else tokens = tonumber(tokens) end
if lastRefill == false then lastRefill = now else lastRefill = tonumber(lastRefill) end
local elapsed = now - lastRefill
if elapsed >= refillWindow then
  local cycles = math.floor(elapsed / refillWindow)
  local refill = cycles * refillRate
  tokens = math.min(tokens + refill, maxTokens)
  lastRefill = lastRefill + cycles * refillWindow
end
local ok = 0
local retAfter = 0
if tokens > 0 then
  tokens = tokens - 1
  ok = 1
else
  local waitMs = lastRefill + refillWindow - now
  retAfter = math.ceil(waitMs / 1000)
  if retAfter < 1 then retAfter = 1 end
end
redis.call('HSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
redis.call('EXPIRE', key, ttlSec)
return {ok, retAfter}
`

async function kvRateLimit(bucketKey: string, cfg: BucketConfig, now: number): Promise<{ ok: boolean; retAfter: number }> {
  const kv = getKv()
  const kvKey = `rl:${bucketKey}`
  const res = await kv.eval<number[]>(
    KV_TOKEN_BUCKET_SCRIPT,
    [kvKey],
    [String(cfg.maxTokens), String(cfg.refillRate), String(cfg.refillWindow), String(now), String(KV_BUCKET_TTL_SEC)],
  )
  const ok = Array.isArray(res) ? Number(res[0]) : 0
  const retAfter = Array.isArray(res) ? Number(res[1]) : 1
  return { ok: ok === 1, retAfter: ok === 1 ? 0 : (retAfter > 0 ? retAfter : 1) }
}

/**
 * Rate-limit con store selezionabile: KV condiviso quando configurato
 * (RATELIMIT_KV non è "0"), altrimenti token bucket per-processo.
 * È async da quando esiste il percorso KV: tutte le call site fanno `await`.
 */
export async function rateLimit(key: string, bucket: string): Promise<{ ok: boolean; retAfter: number }> {
  const cfg = limits[bucket] || limits.default
  const now = Date.now()
  // Chiave composta (bucket, client): con la chiave client condivisa "shared"
  // (senza PICTORIUM_TRUST_PROXY) tutte le route finivano in un UNICO bucket
  // il cui maxTokens/refill veniva sovrascritto dall'ultima route chiamata
  // (una chiamata warmup con max 5 sgonfiava il bucket di poster/tmdb e
  // viceversa, rendendo i limiti per-route illusori).
  const bucketKey = `${bucket}:${key}`
  if (isKvStore()) {
    try {
      return await kvRateLimit(bucketKey, cfg, now)
    } catch (error) {
      logKvFallback(error)
      // fallback: bucket in-memory di questo processo
    }
  }
  return memoryRateLimit(bucketKey, cfg, now)
}

// RFC 7230 token: anything else makes Headers.get() throw on every request.
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9a-z-]+$/
const warnedPinned = new Set<string>()

// Warning una volta per processo: multi-user senza TRUST_PROXY=1 condivide il
// bucket "local" tra tutti i client anonimi (vedi rateLimitKey).
let warnedLockout = false

function warnLockoutRiskOnce(): void {
  if (warnedLockout) return
  warnedLockout = true
  log.warn(
    'multi-user without TRUST_PROXY=1 shares one "local" rate-limit bucket for all clients, so anyone knowing a user UUID can trigger the password fail limiter for that user; set TRUST_PROXY=1 (and CLIENT_IP_HEADER) behind a proxy',
  )
}

function warnPinnedHeaderOnce(kind: "invalid" | "missing" | "multi", header: string): void {
  if (warnedPinned.has(kind)) return
  warnedPinned.add(kind)
  const reason = {
    invalid: "is not a valid header name; setting ignored",
    missing: "is absent from requests; falling back to per-user-agent buckets",
    multi: "carries a comma-separated list; it must be a single value set by the proxy",
  }[kind]
  log.warn(`PICTORIUM_CLIENT_IP_HEADER "${header}" ${reason}`)
}

/** Validated, lowercased pinned header name, or "" when unset/invalid. */
function pinnedClientIpHeader(): string {
  const name = (envWithFallback("CLIENT_IP_HEADER") || "").trim().toLowerCase()
  if (!name) return ""
  if (!HEADER_NAME_RE.test(name)) {
    warnPinnedHeaderOnce("invalid", name)
    return ""
  }
  return name
}

export function rateLimitKey(request: Request): string {
  // Estrae l'IP client per il rate limit. Precedenza: header pinnato
  // (CLIENT_IP_HEADER + TRUST_PROXY=1) > x-real-ip/cf-connecting-ip (solo se
  // trusted) > x-forwarded-for primo hop (solo se trusted, anti H2 bucket
  // pollution) > fallback `local`. Senza trust nessun header IP è usato (sono
  // tutti spoofabili da chi raggiunge l'origin direttamente) e nemmeno lo
  // User-Agent distingue i bucket: senza trust l'unica identità affidabile è
  // lo spazio utente verificato (userRateLimitKey).
  const trusted = envWithFallback("TRUST_PROXY") === "1"
  // PICTORIUM_CLIENT_IP_HEADER (with TRUST_PROXY=1): trust exactly one header,
  // e.g. "cf-connecting-ip" behind Cloudflare. Cloudflare does not set
  // x-real-ip but forwards one a client sends, so the default order below
  // would let that client pick its own bucket. The header must be a single
  // value that the proxy overwrites (not X-Forwarded-For, which proxies append
  // to): comma-separated values are refused.
  const pinnedHeader = trusted ? pinnedClientIpHeader() : ""
  if (pinnedHeader) {
    const raw = request.headers.get(pinnedHeader)?.trim() ?? ""
    if (raw && !raw.includes(",")) return raw
    warnPinnedHeaderOnce(raw ? "multi" : "missing", pinnedHeader)
    const uaPinned = request.headers.get("user-agent")
    return uaPinned ? `ua:${uaPinned.slice(0, 48)}` : "local"
  }
  // Solo dietro proxy fidato (v1.23.0): x-real-ip/cf-connecting-ip sono
  // scrivibili da chiunque raggiunga l'origin direttamente — fidarsene
  // sempre permette di ruotare bucket falsi ed evadere il rate limit.
  // Dietro Cloudflare/proxy che li sovrascrive, TRUST_PROXY=1 li riabilita.
  // Cloudflare inoltra un x-real-ip inviato dal client (spoofabile): preferire
  // cf-connecting-ip (sovrascritto da Cloudflare) quando presente, poi
  // x-real-ip (Nginx/HF che lo sovrascrivono). x-real-ip da solo resta
  // valido solo dietro proxy che lo sovrascrivono davvero; altrimenti usare
  // CLIENT_IP_HEADER per fissare l'header affidabile.
  if (trusted) {
    const cfIp = request.headers.get("cf-connecting-ip")
    if (cfIp) return cfIp.trim()
    const realIp = request.headers.get("x-real-ip")
    if (realIp) return realIp.trim()
  }
  // 3) x-forwarded-for — solo se trusted, altrimenti spoofabile (H2).
  // Catena "client, proxy1, proxy2": il client è il PRIMO elemento.
  // Prendere l'ultimo raggrupperebbe tutti gli utenti dietro lo stesso
  // proxy/gateway nello stesso bucket (falsi 429).
  if (trusted) {
    const forwarded = request.headers.get("x-forwarded-for")
    if (forwarded) {
      const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean)
      if (parts.length > 0) {
        const ip = parts[0]
        if (ip) return ip
      }
    }
  }
  // Fallback SENZA proxy fidato: nessuna identità di rete è affidabile, e
  // nemmeno lo User-Agent lo è (è un header client arbitrario). Il vecchio
  // fallback per-UA creava un bucket nuovo a ogni rotazione dello UA, cioè un
  // bypass completo del rate limit su poster/auth/cataloghi con la env di
  // default. Qui tutti gli anonimi condividono UN bucket d'istanza "local":
  // l'isolamento reale per utente resta su `userRateLimitKey` (IP+UUID, solo
  // dopo la verifica di esistenza del namespace), e i bucket per-UA tornano
  // disponibili solo dietro `TRUST_PROXY=1` (ramo sotto, byte-identico).
  if (!trusted) {
    // Letto direttamente dall'env (non via user-auth.isMultiUserEnabled): user-auth importa questo modulo.
    if (envWithFallback("MULTI_USER") === "1") warnLockoutRiskOnce()
    return "local"
  }
  // Dietro proxy fidato: granularità minima per user-agent come fallback.
  const ua = request.headers.get("user-agent")
  if (ua) return `ua:${ua.slice(0, 48)}`
  return "local"
}

export function rateLimitResponse(retryAfter: number): Response {
  return new Response(JSON.stringify({ error: "Troppe richieste. Attendi qualche secondo." }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfter),
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
    },
  })
}
