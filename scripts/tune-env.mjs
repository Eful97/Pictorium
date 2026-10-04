// Pictorium env tuner — stima variabili ottimizzate per la macchina corrente.
//
// Livello 1 (default, istantaneo, zero carico): euristica da CPU/RAM/limiti
// container sui default reali del codice (poster-runtime-cache.ts,
// sharp-config.ts, cache.ts, image-bytes-cache.ts).
// Livello 2 (opt-in --bench): sweep dinamico su istanza isolata
// (mock-server + next dev su porte dedicate, come load-smoke.mjs) che prova
// 2-3 candidati MAX_CONCURRENT_RENDERS x SHARP_CONCURRENCY e sceglie il
// migliore per p95 a zero errori.
//
// Portabile: solo stdlib Node, Linux/Windows/macOS, bare-metal/VPS/Docker.
// Non scrive nulla senza --apply/--out: di default stampa solo.
//
// Uso:
//   node scripts/tune-env.mjs
//   node scripts/tune-env.mjs --bench --bench-n 20
//   node scripts/tune-env.mjs --json --mem-mb 1024 --cpus 2
//   node scripts/tune-env.mjs --apply
//   npm run tune -- --bench
//
// Env equivalenti alle flag: TUNE_BENCH=1 TUNE_JSON=1 TUNE_APPLY=1
//   TUNE_OUT=.env.tuned TUNE_MEM_MB=1024 TUNE_CPUS=2 TUNE_CANDIDATES=2,4,6
//   TUNE_BENCH_N=20 TUNE_PORT=3191 TUNE_MOCK_PORT=8799

import { spawn } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const TUNED_KEYS = [
  "PICTORIUM_MAX_CONCURRENT_RENDERS",
  "SHARP_CONCURRENCY",
  "SHARP_CACHE_MEMORY_MB",
  "PICTORIUM_CACHE_MAX_MB",
  "PICTORIUM_CACHE_MAX",
  "PICTORIUM_IMG_CACHE_MB",
]

function parseArgs(argv) {
  const o = {
    bench: false,
    json: false,
    apply: false,
    out: "",
    memMb: 0,
    cpus: 0,
    candidates: "",
    benchN: 0,
    port: 0,
    mockPort: 0,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === "--bench") o.bench = true
    else if (a === "--json") o.json = true
    else if (a === "--apply") o.apply = true
    else if (a === "--help" || a === "-h") o.help = true
    else if (a === "--out" && next) { o.out = next; i++ }
    else if (a === "--mem-mb" && next) { o.memMb = Number(next); i++ }
    else if (a === "--cpus" && next) { o.cpus = Number(next); i++ }
    else if (a === "--candidates" && next) { o.candidates = next; i++ }
    else if (a === "--bench-n" && next) { o.benchN = Number(next); i++ }
    else if (a === "--port" && next) { o.port = Number(next); i++ }
    else if (a === "--mock-port" && next) { o.mockPort = Number(next); i++ }
    else if (a.startsWith("--out=")) o.out = a.slice(6)
    else if (a.startsWith("--mem-mb=")) o.memMb = Number(a.slice(9))
    else if (a.startsWith("--cpus=")) o.cpus = Number(a.slice(7))
    else if (a.startsWith("--candidates=")) o.candidates = a.slice(13)
    else if (a.startsWith("--bench-n=")) o.benchN = Number(a.slice(10))
    else throw new Error(`Flag sconosciuta: ${a} (usa --help)`)
  }
  if (process.env.TUNE_BENCH === "1") o.bench = true
  if (process.env.TUNE_JSON === "1") o.json = true
  if (process.env.TUNE_APPLY === "1") o.apply = true
  if (!o.out && process.env.TUNE_OUT) o.out = process.env.TUNE_OUT
  if (!o.memMb && Number(process.env.TUNE_MEM_MB) > 0) o.memMb = Number(process.env.TUNE_MEM_MB)
  if (!o.cpus && Number(process.env.TUNE_CPUS) > 0) o.cpus = Number(process.env.TUNE_CPUS)
  if (!o.candidates && process.env.TUNE_CANDIDATES) o.candidates = process.env.TUNE_CANDIDATES
  if (!o.benchN && Number(process.env.TUNE_BENCH_N) > 0) o.benchN = Number(process.env.TUNE_BENCH_N)
  if (!o.port && Number(process.env.TUNE_PORT) > 0) o.port = Number(process.env.TUNE_PORT)
  if (!o.mockPort && Number(process.env.TUNE_MOCK_PORT) > 0) o.mockPort = Number(process.env.TUNE_MOCK_PORT)
  return o
}

const HELP = `Pictorium env tuner
Uso: node scripts/tune-env.mjs [flag]
  --bench            sweep dinamico su istanza isolata (altrimenti solo euristica)
  --bench-n N        richieste per candidato (default 20, 8-60)
  --candidates a,b,c slot da provare (default derivati dall'euristica, max 4)
  --mem-mb N         override RAM effettiva in MB (utile: Docker Desktop Mac/Win)
  --cpus N           override vCPU visibili
  --port N           porta app isolata (default 3191)
  --mock-port N      porta mock isolato (default 8799)
  --json             output JSON su stdout (log su stderr)
  --apply            scrive le chiavi in .env.local (merge, mai NODE_OPTIONS)
  --out FILE         scrive il blocco env in FILE invece di .env.local
  --help             questa guida
Esempi:
  node scripts/tune-env.mjs --mem-mb 1024 --cpus 2
  node scripts/tune-env.mjs --bench --bench-n 20
  npm run tune -- --bench --json`

// --- Rilevamento host -------------------------------------------------------

function readContainerLimitMb() {
  // Solo Linux: altrove i file non esistono → null senza errori.
  const files = [
    "/sys/fs/cgroup/memory.max", // cgroup v2: numero o "max"
    "/sys/fs/cgroup/memory/memory.limit_in_bytes", // cgroup v1
  ]
  for (const f of files) {
    try {
      const raw = readFileSync(f, "utf8").trim()
      if (!raw || raw === "max") continue
      const bytes = Number(raw)
      if (Number.isFinite(bytes) && bytes > 0 && bytes < Number.MAX_SAFE_INTEGER) {
        return Math.floor(bytes / 1024 / 1024)
      }
    } catch {
      // assente o illeggibile: non un container cgroup, si ignora
    }
  }
  return null
}

function detectHost(overrides) {
  const cpus = overrides.cpus > 0 ? Math.floor(overrides.cpus)
    : Math.max(1, os.cpus()?.length || 1)
  const totalMb = Math.max(256, Math.floor(os.totalmem() / 1024 / 1024))
  const containerMb = readContainerLimitMb()
  // Override esplicito vince su tutto (caso Docker Desktop: l'host mente).
  let effectiveMb = overrides.memMb > 0 ? Math.floor(overrides.memMb) : totalMb
  let limitedBy = overrides.memMb > 0 ? "override" : "host"
  if (!(overrides.memMb > 0) && containerMb && containerMb < effectiveMb) {
    effectiveMb = containerMb
    limitedBy = "cgroup"
  }
  const inDocker = existsSync("/.dockerenv")
  const vercel = !!process.env.VERCEL
  const hostMismatchRisk = (process.platform === "darwin" || process.platform === "win32")
    && !(overrides.memMb > 0)
  return {
    platform: process.platform,
    cpus,
    totalMemMb: totalMb,
    effectiveMemMb: Math.max(256, effectiveMb),
    limitedBy,
    inDocker,
    vercel,
    hostMismatchRisk,
  }
}

// --- Euristica (default reali del codice, vedi commenti) --------------------

export function recommend(host) {
  const mem = host.effectiveMemMb
  const cpus = Math.max(1, host.cpus)
  const reasons = []
  let tier
  // Ogni miss tiene poster+logo+backdrop+buffer RGBA in memoria (decine di MB):
  // su heap piccoli si resta bassi di slot anche con molte vCPU.
  if (mem < 1024 || cpus <= 1) {
    tier = "tiny"
    reasons.push(`${mem}MB/${cpus}cpu: profilo conservativo anti-OOM`)
  } else if (mem < 2048 || cpus <= 2) {
    tier = "small"
    reasons.push(`${mem}MB/${cpus}cpu: profilo VPS piccola`)
  } else if (mem < 8192 || cpus <= 4) {
    tier = "medium"
    reasons.push(`${mem}MB/${cpus}cpu: profilo standard (vicino ai default)`)
  } else {
    tier = "large"
    reasons.push(`${mem}MB/${cpus}cpu: profilo macchina grossa`)
  }
  if (host.limitedBy === "cgroup") reasons.push("limite container rilevato via cgroup")
  if (host.limitedBy === "override") reasons.push("RAM da override --mem-mb/TUNE_MEM_MB")
  if (host.inDocker) reasons.push("rilevato /.dockerenv")
  if (host.vercel) reasons.push("ambiente Vercel: timeout/slot hobby-safe")
  if (host.hostMismatchRisk) {
    reasons.push("ATTENZIONE: su macOS/Windows la RAM host sovrastima il container — riusa con --mem-mb o gira dentro il container")
  }

  // sharp: mai sopra le CPU; sui piccoli 1 thread (i render si sovrappongono in I/O).
  let rec
  if (tier === "tiny") {
    rec = {
      maxConcurrentRenders: 2, sharpConcurrency: 1,
      sharpCacheMemoryMb: 32, sharpCacheItems: 50,
      cacheMaxMb: 64, cacheMaxEntries: 1000, imgCacheMb: 16,
      nodeOldSpaceMb: mem < 768 ? 256 : 384,
    }
  } else if (tier === "small") {
    rec = {
      maxConcurrentRenders: 3, sharpConcurrency: Math.min(cpus, 2),
      sharpCacheMemoryMb: 32, sharpCacheItems: 50,
      cacheMaxMb: 96, cacheMaxEntries: 1500, imgCacheMb: 24,
      nodeOldSpaceMb: 512,
    }
  } else if (tier === "medium") {
    rec = {
      maxConcurrentRenders: 4, sharpConcurrency: Math.min(cpus, 2),
      sharpCacheMemoryMb: 64, sharpCacheItems: 50,
      cacheMaxMb: 150, cacheMaxEntries: 2000, imgCacheMb: 32,
      nodeOldSpaceMb: 768,
    }
  } else {
    rec = {
      maxConcurrentRenders: Math.min(6, Math.max(4, Math.floor(cpus / 2))),
      sharpConcurrency: Math.min(cpus, 4),
      sharpCacheMemoryMb: mem >= 16384 ? 128 : 64, sharpCacheItems: 50,
      cacheMaxMb: 256, cacheMaxEntries: 3000, imgCacheMb: 48,
      nodeOldSpaceMb: mem >= 16384 ? 2048 : 1024,
    }
  }
  // NODE heap mai oltre metà RAM effettiva (il resto serve a sharp nativo+RSS).
  rec.nodeOldSpaceMb = Math.min(rec.nodeOldSpaceMb, Math.max(256, Math.floor(mem * 0.5)))
  return {
    tier,
    ...rec,
    // Default codice: 15000 (7500 su Vercel); 30000 (8500 su Vercel). Il tuner
    // non li tocca fuori Vercel: allungare l'attesa è memory-neutral ma è
    // policy, non sizing macchina.
    renderSlotWaitMs: host.vercel ? 7500 : 15000,
    renderTimeoutMs: host.vercel ? 8500 : 30000,
    reasons,
  }
}

export function sharpForSlots(slots, cpus) {
  if (slots <= 2) return 1
  if (slots <= 4) return Math.min(cpus, 2)
  return Math.min(cpus, 4)
}

export function defaultCandidates(heuristicSlots) {
  const set = new Set([
    Math.max(1, heuristicSlots - 1),
    heuristicSlots,
    Math.min(8, heuristicSlots + 2),
  ])
  return [...set].sort((a, b) => a - b).slice(0, 4)
}

export function parseCandidates(raw, fallback) {
  if (!raw) return fallback
  const list = String(raw).split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 8)
    .map((n) => Math.floor(n))
  const uniq = [...new Set(list)].sort((a, b) => a - b).slice(0, 4)
  if (uniq.length === 0) throw new Error(`--candidates non valido: "${raw}" (es. 2,4,6)`)
  return uniq
}

// --- Output -----------------------------------------------------------------

function envBlock(rec) {
  return [
    `# Pictorium tuning — ${rec.tier} (generato ${new Date().toISOString()}, non editare a mano: riusa tune-env.mjs)`,
    `PICTORIUM_MAX_CONCURRENT_RENDERS=${rec.maxConcurrentRenders}`,
    `SHARP_CONCURRENCY=${rec.sharpConcurrency}`,
    `SHARP_CACHE_MEMORY_MB=${rec.sharpCacheMemoryMb}`,
    `PICTORIUM_CACHE_MAX_MB=${rec.cacheMaxMb}`,
    `PICTORIUM_CACHE_MAX=${rec.cacheMaxEntries}`,
    `PICTORIUM_IMG_CACHE_MB=${rec.imgCacheMb}`,
    `# NODE heap: avvia con NODE_OPTIONS=--max-old-space-size=${rec.nodeOldSpaceMb} (richiede restart, non va in .env)`,
  ].join("\n")
}

function mergeIntoEnvFile(filePath, rec) {
  const header = `# Pictorium tuning — ${rec.tier} (${new Date().toISOString()})`
  const values = {
    PICTORIUM_MAX_CONCURRENT_RENDERS: String(rec.maxConcurrentRenders),
    SHARP_CONCURRENCY: String(rec.sharpConcurrency),
    SHARP_CACHE_MEMORY_MB: String(rec.sharpCacheMemoryMb),
    PICTORIUM_CACHE_MAX_MB: String(rec.cacheMaxMb),
    PICTORIUM_CACHE_MAX: String(rec.cacheMaxEntries),
    PICTORIUM_IMG_CACHE_MB: String(rec.imgCacheMb),
  }
  let lines = []
  try {
    if (existsSync(filePath)) lines = readFileSync(filePath, "utf8").split("\n")
  } catch {
    lines = []
  }
  const wanted = new Set(Object.keys(values))
  const out = []
  let sawHeader = false
  for (const line of lines) {
    const m = line.match(/^\s*(PICTORIUM_MAX_CONCURRENT_RENDERS|SHARP_CONCURRENCY|SHARP_CACHE_MEMORY_MB|PICTORIUM_CACHE_MAX_MB|PICTORIUM_CACHE_MAX|PICTORIUM_IMG_CACHE_MB)\s*=/)
    if (m && wanted.has(m[1])) {
      out.push(`${m[1]}=${values[m[1]]}`)
      wanted.delete(m[1])
    } else {
      out.push(line)
    }
    if (line.includes("Pictorium tuning")) sawHeader = true
  }
  for (const k of TUNED_KEYS) {
    if (wanted.has(k)) out.push(`${k}=${values[k]}`)
  }
  if (!sawHeader) out.unshift(header)
  // Evita riga vuota finale multipla ma conserva newline di chiusura.
  writeFileSync(filePath, `${out.join("\n").replace(/\n+$/, "")}\n`)
}

// --- Bench sweep su istanza isolata ------------------------------------------

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

async function waitFor(url, timeoutMs, headers = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { headers })
      if (res.ok) return
    } catch {
      // non ancora pronto
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Timeout attendendo ${url}`)
}

async function benchCandidate({ appUrl, n, baseId }) {
  const ids = Array.from({ length: n }, (_, i) => baseId + i)
  const t0 = Date.now()
  const results = await Promise.all(ids.map(async (id) => {
    const s = Date.now()
    try {
      const res = await fetch(`${appUrl}/api/poster/movie/${id}`)
      await res.arrayBuffer().catch(() => {})
      return { status: res.status, ms: Date.now() - s }
    } catch {
      return { status: 0, ms: Date.now() - s }
    }
  }))
  const lat = results.map((r) => r.ms).sort((a, b) => a - b)
  const ok = results.filter((r) => r.status === 200).length
  const busy = results.filter((r) => r.status === 503).length
  const errors = results.filter((r) => r.status !== 200 && r.status !== 503).length
  return {
    ok, busy, errors,
    p50: percentile(lat, 0.5),
    p95: percentile(lat, 0.95),
    totalMs: Date.now() - t0,
  }
}

function pickWinner(rows) {
  // Primario: zero errori; poi zero 503; poi p95; a parità (entro 20%) vince lo
  // slot minore (meno RAM per lo stesso servizio).
  const usable = rows.filter((r) => r.ok > 0)
  if (usable.length === 0) return { winner: null, reason: "nessun poster servito" }
  const noErr = usable.filter((r) => r.errors === 0)
  const pool = noErr.length > 0 ? noErr : usable
  const noBusy = pool.filter((r) => r.busy === 0)
  const ranked = (noBusy.length > 0 ? noBusy : pool).slice().sort((a, b) => a.p95 - b.p95)
  const best = ranked[0]
  const frugal = ranked
    .filter((r) => r.p95 <= best.p95 * 1.2)
    .sort((a, b) => a.slots - b.slots)[0]
  const reason = noErr.length === 0
    ? "tutti i candidati hanno errori: scelto il meno peggio (da verificare)"
    : frugal.slots !== best.slots
      ? `p95 entro 20% dal migliore ma con meno slot (memoria)`
      : "p95 minore a zero errori"
  return { winner: frugal, reason }
}

async function runBench({ rec, host, candidates, benchN, port, mockPort, log }) {
  const remote = process.env.PICTORIUM_BASE_URL || process.env.POSTERIUM_BASE_URL
  if (remote) {
    throw new Error("PICTORIUM_BASE_URL impostato: il bench cambia env per candidato e richiede un'istanza isolata (togli BASE_URL)")
  }
  const mockUrl = `http://127.0.0.1:${mockPort}`
  const appUrl = `http://127.0.0.1:${port}`
  const nextBin = path.join(rootDir, "node_modules", "next", "dist", "bin", "next")
  if (!existsSync(nextBin)) throw new Error(`next non trovato in ${nextBin} (esegui npm install)`)
  const rows = []
  let baseId = 980001
  for (const slots of candidates) {
    const sharp = sharpForSlots(slots, host.cpus)
    log(`candidate slot=${slots} sharp=${sharp} (${benchN} titoli freddi)…`)
    const children = []
    const spawnNode = (args, env) => {
      const c = spawn(process.execPath, args, { cwd: rootDir, env: { ...process.env, ...env }, stdio: ["ignore", "inherit", "inherit"] })
      children.push(c)
      return c
    }
    const killAll = () => {
      for (const c of children) { try { c.kill() } catch { /* già uscito */ } }
    }
    try {
      spawnNode([path.join(rootDir, "e2e", "mock-server.mjs")], { MOCK_PORT: String(mockPort) })
      await waitFor(`${mockUrl}/healthz`, 15000)
      const dataDir = path.join(rootDir, ".next-tune", `data-${slots}`)
      spawnNode([nextBin, "dev", "-H", "127.0.0.1", "-p", String(port)], {
        NEXT_DIST_DIR: ".next-tune",
        POSTERIUM_DATA_DIR: dataDir,
        PICTORIUM_DATA_DIR: dataDir,
        NODE_OPTIONS: `--max-old-space-size=${rec.nodeOldSpaceMb}`,
        PORT: String(port),
        MAX_CONCURRENT_RENDERS: String(slots),
        PICTORIUM_MAX_CONCURRENT_RENDERS: String(slots),
        SHARP_CONCURRENCY: String(sharp),
        SHARP_CACHE_MEMORY_MB: String(rec.sharpCacheMemoryMb),
        PICTORIUM_CACHE_MAX_MB: String(rec.cacheMaxMb),
        PICTORIUM_CACHE_MAX: String(rec.cacheMaxEntries),
        PICTORIUM_IMG_CACHE_MB: String(rec.imgCacheMb),
        RATELIMIT_POSTER_MAX: "10000",
        PICTORIUM_RATELIMIT_POSTER_MAX: "10000",
        TMDB_BASE_URL: `${mockUrl}/3`,
        TMDB_IMG_URL: `${mockUrl}/t/p`,
        NEXT_PUBLIC_TMDB_IMG_URL: `${mockUrl}/t/p`,
        JUSTWATCH_API_URL: `${mockUrl}/graphql`,
        WIKIDATA_SPARQL_URL: `${mockUrl}/sparql`,
        WIKIDATA_API_URL: `${mockUrl}/w/api.php`,
        IMDB_CHART_URL: `${mockUrl}/chart/top`,
        MDBLIST_API_URL: `${mockUrl}/mdblist/api`,
      })
      await waitFor(`${appUrl}/api/health`, 120000, { "x-api-key": "mock-key" })
      for (let i = 0; i < 3; i++) {
        await fetch(`${appUrl}/api/poster/movie/${19990 + i}`).then((r) => r.arrayBuffer().catch(() => {})).catch(() => {})
      }
      const m = await benchCandidate({ appUrl, n: benchN, baseId })
      rows.push({ slots, sharp, ...m })
      log(`  → ok=${m.ok}/${benchN} 503=${m.busy} err=${m.errors} p50=${m.p50}ms p95=${m.p95}ms`)
      baseId += 10000
    } finally {
      killAll()
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
  return rows
}

// --- Main --------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const log = (m) => {
    if (args.json) console.error(`[tune-env] ${m}`)
    else console.log(`[tune-env] ${m}`)
  }
  if (args.help) {
    console.log(HELP)
    return
  }
  const host = detectHost({ memMb: args.memMb, cpus: args.cpus })
  const rec = recommend(host)
  const candidates = parseCandidates(args.candidates, defaultCandidates(rec.maxConcurrentRenders))
  const benchN = args.benchN > 0 ? Math.min(60, Math.max(8, Math.floor(args.benchN))) : 20
  const port = args.port > 0 ? args.port : 3191
  const mockPort = args.mockPort > 0 ? args.mockPort : 8799

  let benchRows = null
  let winner = null
  let winnerReason = ""
  let finalRec = rec
  if (args.bench) {
    log(`host ${host.platform} ${host.cpus}cpu ${host.effectiveMemMb}MB (limite: ${host.limitedBy})`)
    benchRows = await runBench({ rec, host, candidates, benchN, port, mockPort, log })
    const picked = pickWinner(benchRows)
    winner = picked.winner
    winnerReason = picked.reason
    if (winner) {
      finalRec = { ...rec, maxConcurrentRenders: winner.slots, sharpConcurrency: winner.sharp }
      log(`vincitore: slot=${winner.slots} sharp=${winner.sharp} (${winnerReason})`)
    } else {
      log(`WARN: ${winnerReason} — tengo l'euristica`)
    }
  }

  const block = envBlock(finalRec)
  if (args.apply || args.out) {
    const file = args.out || path.join(rootDir, ".env.local")
    mergeIntoEnvFile(file, finalRec)
    log(`scritto in ${file} (merge chiavi ${TUNED_KEYS.join(",")}; NODE_OPTIONS da impostare al restart)`)
  }

  if (args.json) {
    console.log(JSON.stringify({
      host,
      heuristic: rec,
      candidates,
      bench: benchRows,
      winner: winner ? { ...winner, reason: winnerReason } : null,
      recommendation: finalRec,
      envBlock: block,
      restart: `NODE_OPTIONS=--max-old-space-size=${finalRec.nodeOldSpaceMb}`,
    }, null, 2))
    return
  }

  console.log(`\nHost: ${host.platform} ${host.cpus}cpu ${host.effectiveMemMb}MB effettivi (tot ${host.totalMemMb}MB, limite: ${host.limitedBy})`)
  for (const r of rec.reasons) console.log(`- ${r}`)
  if (benchRows) {
    console.log("\nSweep (istanze isolate, next dev, mock deterministico):")
    for (const r of benchRows) {
      const mark = winner && r.slots === winner.slots ? " <= vincitore" : ""
      console.log(`  slot=${r.slots} sharp=${r.sharp} ok=${r.ok} 503=${r.busy} err=${r.errors} p50=${r.p50}ms p95=${r.p95}ms${mark}`)
    }
    if (winner) console.log(`Scelta: ${winnerReason}`)
    else console.log(`Scelta: ${winnerReason} → euristica`)
  }
  console.log("\nVariabili consigliate (richiedono restart):\n")
  console.log(block)
  console.log("\nApplica con: node scripts/tune-env.mjs --apply   (oppure --out FILE)")
  console.log(`Avvio: NODE_OPTIONS=--max-old-space-size=${finalRec.nodeOldSpaceMb}`)
}

const invokedAsScript = (() => {
  try {
    return path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
})()
if (invokedAsScript) {
  main().catch((e) => {
    console.error(`[tune-env] Errore: ${e.message}`)
    process.exit(1)
  })
}
