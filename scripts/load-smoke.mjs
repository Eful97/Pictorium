// Load smoke test per la render pipeline poster (Fase D del piano di hardening).
//
// Avvia il mock server + l'app (o usa PICTORIUM_BASE_URL se già in esecuzione),
// poi spara N richieste concorrenti su titoli freddi non-mappati e misura:
//   - % 503 (backpressure dello slot limiter — atteso sotto burst, non un errore)
//   - poster/sec e latenze p50/p95
//
// Assert (exit != 0): errori 500/429/404/rete, oppure zero poster serviti.
// Il mock serve details deterministici per QUALSIASI id numerico: un 404 qui
// è un bug del render, non un titolo mancante.
//
// NOTA heap: non si misura più process.memoryUsage() dell'orchestratore (era
// il processo sbagliato — lo script non renderizza nulla). Per il consumo
// reale usare /api/cache/status o metriche del processo app.
//
// Uso base (invariato, retrocompatibile):
//   node scripts/load-smoke.mjs                       # avvia tutto (mock + next dev)
//   PICTORIUM_BASE_URL=http://127.0.0.1:3100 node scripts/load-smoke.mjs
//   LOAD_REQUESTS=80 LOAD_CONCURRENCY=20 node scripts/load-smoke.mjs
//
// Modalità hardening (LOAD TEST HARDENING):
//   LOAD_MODE=coalesce|burst|warm|swr|jitter|soak|all   (default: burst)
//   LOAD_START=dev|start                (default: dev; start = next build + next start)
//   LOAD_DIST_DIR=.next-stress          (default: .next-load)
//   LOAD_SKIP_BUILD=1                   (con LOAD_START=start, salta la build se il distDir è già pronto)
//   LOAD_WAVES=1,10,25,50               (burst a ondate; assente = burst singolo legacy)
//   LOAD_SOAK_N=100 LOAD_SOAK_CONC=5 LOAD_SOAK_IDLE_MS=15000
//   LOAD_POLL_MS=75 LOAD_SETTLE_MS=5000
//   BENCH_ADMIN_TOKEN=<token>           (per /api/cache/status; inoltrato al figlio come PICTORIUM_ADMIN_TOKEN)
//   Esempio bench completo:
//     LOAD_MODE=all LOAD_START=start LOAD_DIST_DIR=.next-stress LOAD_WAVES=1,10,25,50 \
//       BENCH_ADMIN_TOKEN=secret node scripts/load-smoke.mjs
//
// Range ID disgiunti per isolamento cache (mai overlap tra scenari):
//   warmup 19990x — coalesce 990001 — burst 91xxxx — soak 92xxxx — warm 930001 — swr 950001 — jitter 94xxxx — legacy 900xxx
//
// Ogni scenario segue il ciclo: health → warmup → snapshot A → scenario
// (+polling + picchi server-side peakActive/peakQueued) → settle → snapshot B
// → delta → PASS/FAIL.
// Lo soak aggiunge idle → snapshot C (stabilizzazione memoria su delta, mai
// soglie assolute).

import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const BASE_URL = process.env.PICTORIUM_BASE_URL || process.env.POSTERIUM_BASE_URL || ""
const PORT = Number(process.env.LOAD_PORT) || 3101
const MOCK_PORT = Number(process.env.LOAD_MOCK_PORT) || 8791
const N = Number(process.env.LOAD_REQUESTS) || 40
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY) || 10
const MODE = (process.env.LOAD_MODE || "burst").toLowerCase()
const START = (process.env.LOAD_START || "dev").toLowerCase()
const DIST_DIR = process.env.LOAD_DIST_DIR || ".next-load"
const SKIP_BUILD = process.env.LOAD_SKIP_BUILD === "1"
const WAVES = (process.env.LOAD_WAVES || "")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0)
const SOAK_N = Number(process.env.LOAD_SOAK_N) || 100
const SOAK_CONC = Number(process.env.LOAD_SOAK_CONC) || 5
const SOAK_IDLE_MS = Number(process.env.LOAD_SOAK_IDLE_MS) || 15000
const POLL_MS = Number(process.env.LOAD_POLL_MS) || 75
const SETTLE_MS = Number(process.env.LOAD_SETTLE_MS) || 5000
const COALESCE_N = Number(process.env.LOAD_COALESCE_N) || 100
const appUrl = BASE_URL || `http://127.0.0.1:${PORT}`

const startedAt = Date.now()

function log(msg) {
  console.log(`[load-smoke] ${msg}`)
}

async function waitFor(url, timeoutMs, label, headers = {}) {
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
  throw new Error(`Timeout attendendo ${label} (${url})`)
}

// /api/health risponde 503 senza chiave (S9): in modalità mock va bene una
// chiave finta (il mock la ignora); per un'istanza già in esecuzione
// (PICTORIUM_BASE_URL) impostare LOAD_HEALTH_KEY con una chiave valida.
const healthKey = process.env.LOAD_HEALTH_KEY || "mock-key"

// Token admin per /api/cache/status (fail-closed in production senza token).
// Inoltrato al figlio come PICTORIUM_ADMIN_TOKEN così lo status è leggibile.
const adminToken = process.env.BENCH_ADMIN_TOKEN || process.env.PICTORIUM_ADMIN_TOKEN || ""

function statusHeaders() {
  return adminToken ? { "x-admin-token": adminToken } : {}
}

// Snapshot outbound/status per il confronto prima/dopo (Step 0a): reads
// additive, zero effetto sul carico misurato.
async function statusSnapshot() {
  try {
    const res = await fetch(`${appUrl}/api/cache/status`, { headers: statusHeaders() })
    if (!res.ok) return null
    const j = await res.json()
    return { outbound: j.outbound || {}, rssMb: j.system?.memory?.rssMb ?? null }
  } catch {
    return null
  }
}

function printOutboundDelta(before, after) {
  if (!before || !after) {
    log("Outbound: snapshot non disponibile (status 401? imposta BENCH_ADMIN_TOKEN)")
    return
  }
  log("Outbound Δ per host (intera sessione scenari):")
  const hosts = new Set([...Object.keys(before.outbound || {}), ...Object.keys(after.outbound || {})])
  for (const h of [...hosts].sort()) {
    const b = (before.outbound || {})[h] || { requests: 0, errors: 0 }
    const a = (after.outbound || {})[h] || { requests: 0, errors: 0 }
    log(`  ${h}: +${a.requests - b.requests} req, +${a.errors - b.errors} err, avg ${a.avgMs}ms`)
  }
  if (before.rssMb !== null && after.rssMb !== null) {
    log(`RSS: ${before.rssMb}MB → ${after.rssMb}MB (Δ ${(after.rssMb - before.rssMb).toFixed(1)}MB)`)
  }
}

const children = []
function spawnNode(args, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd: rootDir,
    env: { ...process.env, ...env },
    stdio: ["ignore", "inherit", "inherit"],
  })
  children.push(child)
  return child
}

function spawnNext(cmdArgs, env = {}) {
  return spawnNode([path.join(rootDir, "node_modules", "next", "dist", "bin", "next"), ...cmdArgs], env)
}

async function shutdown(exitCode) {
  for (const child of children) {
    try {
      child.kill()
    } catch {
      // già terminato
    }
  }
  process.exit(exitCode)
}

// --- Snapshot / delta / polling -------------------------------------------

async function snapshot(label) {
  try {
    const res = await fetch(`${appUrl}/api/cache/status`, { headers: statusHeaders() })
    if (!res.ok) {
      log(`Snapshot ${label}: /api/cache/status → HTTP ${res.status} (imposta BENCH_ADMIN_TOKEN per le metriche memoria)`)
      return null
    }
    return await res.json()
  } catch (e) {
    log(`Snapshot ${label}: errore rete (${e.message})`)
    return null
  }
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0
}

const scenarioMatrix = []

function recordMatrix(entry) {
  scenarioMatrix.push(entry)
}

function printMatrix() {
  if (scenarioMatrix.length === 0) return
  const colWidths = {
    scenario: 22,
    p50: 9,
    p95: 9,
    p99: 9,
    renders: 11,
    coalesced: 14,
    maxActive: 11,
    maxQueued: 11,
    errors: 8,
    status: 8,
  }
  const pad = (str, len) => String(str).padEnd(len)
  const sep = "=".repeat(112)
  const line = "-".repeat(112)

  console.log("\n" + sep)
  console.log("                                     CONSOLIDATED LOAD MATRIX")
  console.log(sep)
  console.log(
    pad("Scenario", colWidths.scenario) +
    pad("p50", colWidths.p50) +
    pad("p95", colWidths.p95) +
    pad("p99", colWidths.p99) +
    pad("Renders", colWidths.renders) +
    pad("Coalesced", colWidths.coalesced) +
    pad("MaxActive", colWidths.maxActive) +
    pad("MaxQueued", colWidths.maxQueued) +
    pad("Errors", colWidths.errors) +
    pad("Status", colWidths.status)
  )
  console.log(line)
  for (const row of scenarioMatrix) {
    console.log(
      pad(row.scenario, colWidths.scenario) +
      pad(row.p50, colWidths.p50) +
      pad(row.p95, colWidths.p95) +
      pad(row.p99, colWidths.p99) +
      pad(row.renders, colWidths.renders) +
      pad(row.coalesced, colWidths.coalesced) +
      pad(row.maxActive, colWidths.maxActive) +
      pad(row.maxQueued, colWidths.maxQueued) +
      pad(row.errors, colWidths.errors) +
      pad(row.status, colWidths.status)
    )
  }
  console.log(sep + "\n")
}

function deltaStats(a, b) {
  if (!a || !b) return null
  const pa = a.poster || {}
  const pb = b.poster || {}
  const ma = (a.system && a.system.memory) || {}
  const mb = (b.system && b.system.memory) || {}
  return {
    requests: num(pb.requests) - num(pa.requests),
    hits: num(pb.hits) - num(pa.hits),
    staleHits: num(pb.staleHits) - num(pa.staleHits),
    coalescedHits: num(pb.coalescedHits) - num(pa.coalescedHits),
    renders: num(pb.renders) - num(pa.renders),
    errors: num(pb.errors) - num(pa.errors),
    rssMb: mb.rssMb !== undefined ? +(mb.rssMb - (ma.rssMb || 0)).toFixed(1) : null,
    heapUsedMb: mb.heapUsedMb !== undefined ? +(mb.heapUsedMb - (ma.heapUsedMb || 0)).toFixed(1) : null,
    heapTotalMb: mb.heapTotalMb !== undefined ? +(mb.heapTotalMb - (ma.heapTotalMb || 0)).toFixed(1) : null,
    externalMb: mb.externalMb !== undefined ? +(mb.externalMb - (ma.externalMb || 0)).toFixed(1) : null,
    arrayBuffersMb: mb.arrayBuffersMb !== undefined ? +(mb.arrayBuffersMb - (ma.arrayBuffersMb || 0)).toFixed(1) : null,
    entries: num(b.totalEntries) - num(a.totalEntries),
    bytes: num(b.totalBytes) - num(a.totalBytes),
  }
}

// Picchi server-side (poster-runtime-cache.ts, cumulativi da avvio processo):
// primario rispetto al polling, che può mancare slot brevi. Null se il
// server non li espone (istanza vecchia) → fallback al solo polling.
function serverPeaks(snap) {
  const p = snap && snap.poster
  if (!p || typeof p.peakActiveRenders !== "number") return null
  return { active: p.peakActiveRenders, queued: num(p.peakQueuedRenders) }
}

// Massimo effettivo: server (cumulativo) vs polling (finestra scenario).
function effectivePeaks(snapB, polled) {
  const sp = serverPeaks(snapB)
  return {
    maxActive: Math.max(polled.maxActive, sp ? sp.active : 0),
    maxQueued: Math.max(polled.maxQueued, sp ? sp.queued : 0),
    server: sp,
  }
}
// Polling durante lo scenario: registra i picchi dello slot limiter.
// Gli snapshot prima/dopo non bastano (activeRenders è istantaneo).
// Backup dei picchi server-side: copre slot più brevi del POLL_MS.
function startPolling() {
  const peaks = { maxActive: 0, maxQueued: 0, samples: 0 }
  let stopped = false
  const loop = (async () => {
    while (!stopped) {
      const s = await snapshot("poll")
      if (s && s.poster) {
        peaks.samples++
        peaks.maxActive = Math.max(peaks.maxActive, num(s.poster.activeRenders))
        peaks.maxQueued = Math.max(peaks.maxQueued, num(s.poster.queuedRenders))
      }
      await new Promise((r) => setTimeout(r, POLL_MS))
    }
  })()
  return {
    peaks,
    async stop() {
      stopped = true
      await loop
      return peaks
    },
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

function latencyReport(latencies) {
  const sorted = [...latencies].sort((a, b) => a - b)
  return {
    min: sorted[0] || 0,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1] || 0,
  }
}

async function fetchPoster(id, extra = {}) {
  const start = Date.now()
  try {
    const res = await fetch(`${appUrl}/api/poster/movie/${id}`)
    // Consuma il body per misure oneste (tempo di trasferimento incluso).
    await res.arrayBuffer().catch(() => {})
    const ms = Date.now() - start
    return {
      status: res.status,
      ms,
      retryAfter: res.headers.get("retry-after"),
      cacheControl: res.headers.get("cache-control"),
      contentType: res.headers.get("content-type"),
    }
  } catch (e) {
    return { status: 0, ms: Date.now() - start, networkError: e.message, ...extra }
  }
}

// --- Scenari ---------------------------------------------------------------

// Coalescing: N richieste sullo STESSO titolo freddo.
// Atteso: Δrenders == 1 (tolleranza warn fino a 2 se qualche req arriva dopo
// il settle), Δhits ≈ N-1, maxActive <= 1, zero 500/404/429/503.
async function runCoalesce() {
  const id = 990001
  log(`Coalesce: ${COALESCE_N} richieste su movie/${id} (titolo freddo unico)`)
  const snapA = await snapshot("coalesce-A")
  const polling = startPolling()
  const results = await Promise.all(
    Array.from({ length: COALESCE_N }, () => fetchPoster(id)),
  )
  const peaks = await polling.stop()
  await new Promise((r) => setTimeout(r, SETTLE_MS))
  const snapB = await snapshot("coalesce-B")
  const d = deltaStats(snapA, snapB)
  const eff = effectivePeaks(snapB, peaks)

  const counts = new Map()
  const lat = []
  for (const r of results) {
    counts.set(r.status, (counts.get(r.status) || 0) + 1)
    lat.push(r.ms)
  }
  const lr = latencyReport(lat)
  const bad = (counts.get(500) || 0) + (counts.get(404) || 0) + (counts.get(429) || 0) + (counts.get(0) || 0)
  const busy = counts.get(503) || 0

  log("--- Coalesce ---")
  log(`Status: ${JSON.stringify(Object.fromEntries(counts))}`)
  log(`Latenza min/p50/p95/p99/max: ${lr.min}/${lr.p50}/${lr.p95}/${lr.p99}/${lr.max}ms`)
  if (d) {
    log(`Δrequests=${d.requests} Δrenders=${d.renders} Δhits=${d.hits} Δerrors=${d.errors}`)
    log(`Coalescing ratio: ${d.requests > 0 ? ((d.hits / d.requests) * 100).toFixed(1) : "n/a"}% servite senza re-render`)
  } else {
    log("Δstats: n/a (snapshot non disponibili — imposta BENCH_ADMIN_TOKEN)")
  }
  log(`maxActiveRenders=${eff.maxActive} maxQueued=${eff.maxQueued} (poll ${peaks.maxActive}/${peaks.maxQueued} su ${peaks.samples} campioni, server ${eff.server ? `${eff.server.active}/${eff.server.queued} cumulativi` : "n/a"})`)

  let fail = ""
  if (bad > 0 || busy > 0) fail = `${bad} errori + ${busy} 503 (atteso zero 5xx/429)`
  else if (d && d.renders > 2) fail = `Δrenders=${d.renders} (atteso 1)`
  else if (d && d.renders === 2) log("WARN: Δrenders=2 (tollerato: req arrivata dopo il settle)")
  else if (eff.maxActive > 1) fail = `maxActiveRenders=${eff.maxActive} (atteso <= 1)`

  recordMatrix({
    scenario: `Coalesce (x${COALESCE_N})`,
    p50: `${lr.p50}ms`,
    p95: `${lr.p95}ms`,
    p99: `${lr.p99}ms`,
    renders: d ? `${d.renders}` : "n/a",
    coalesced: d ? `${d.hits}` : "n/a",
    maxActive: `${eff.maxActive}`,
    maxQueued: `${eff.maxQueued}`,
    errors: bad + busy,
    status: fail ? "FAIL" : "PASS",
  })

  if (fail) {
    log(`FAIL coalesce: ${fail}`)
    return 1
  }
  log("PASS coalesce")
  return 0
}

// Burst su titoli freddi DISTINTI: misura throughput + backpressure slot.
// 503 ammessi solo con Retry-After coerente; 500/429/404/rete = errore.
async function runBurstWave(label, ids, concurrency) {
  log(`Burst ${label}: ${ids.length} titoli freddi, concorrenza ${concurrency}`)
  const snapA = await snapshot(`burst-${label}-A`)
  const polling = startPolling()
  const statusCounts = new Map()
  const latencies = []
  let errors = 0
  let retryAfterMissing = 0

  async function worker(queue) {
    while (queue.length > 0) {
      const id = queue.shift()
      const r = await fetchPoster(id)
      statusCounts.set(r.status, (statusCounts.get(r.status) || 0) + 1)
      latencies.push(r.ms)
      if (r.status === 500 || r.status === 429 || r.status === 404 || r.status === 0) {
        errors++
        if (r.status === 0) log(`Errore di rete su movie/${id}: ${r.networkError}`)
      }
      if (r.status === 503 && !r.retryAfter) retryAfterMissing++
    }
  }

  const queue = [...ids]
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, () => worker(queue)))
  const peaks = await polling.stop()
  await new Promise((r) => setTimeout(r, SETTLE_MS))
  const snapB = await snapshot(`burst-${label}-B`)
  const d = deltaStats(snapA, snapB)
  const eff = effectivePeaks(snapB, peaks)
  const lr = latencyReport(latencies)

  const total = ids.length
  const ok = statusCounts.get(200) || 0
  const busy = statusCounts.get(503) || 0
  log(`--- Burst ${label} ---`)
  log(`Status: ${JSON.stringify(Object.fromEntries(statusCounts))}`)
  log(`Poster OK: ${ok}/${total} | 503: ${busy} (Retry-After mancante: ${retryAfterMissing}) | errori 500/429/404/rete: ${errors}`)
  log(`Latenza min/p50/p95/p99/max: ${lr.min}/${lr.p50}/${lr.p95}/${lr.p99}/${lr.max}ms`)
  if (d) log(`Δrenders=${d.renders} Δhits=${d.hits} (atteso Δrenders≈${total} su titoli freddi)`)
  log(`maxActiveRenders=${eff.maxActive} maxQueued=${eff.maxQueued} (poll ${peaks.maxActive}/${peaks.maxQueued}, server ${eff.server ? `${eff.server.active}/${eff.server.queued} cumulativi` : "n/a"})`)

  let fail = ""
  if (errors > 0) fail = `${errors} errori 500/429/404/rete`
  else if (retryAfterMissing > 0) fail = `${retryAfterMissing} 503 senza header Retry-After`
  else if (ok === 0 && total > 0) fail = "nessun poster servito"
  else if (eff.maxActive > Number(process.env.MAX_CONCURRENT_RENDERS || "4")) fail = `maxActiveRenders=${eff.maxActive} oltre gli slot`

  recordMatrix({
    scenario: `Burst ${label}`,
    p50: `${lr.p50}ms`,
    p95: `${lr.p95}ms`,
    p99: `${lr.p99}ms`,
    renders: d ? `${d.renders}` : `${ok}`,
    coalesced: "0",
    maxActive: `${eff.maxActive}`,
    maxQueued: `${eff.maxQueued}`,
    errors: errors + retryAfterMissing,
    status: fail ? "FAIL" : "PASS",
  })

  if (fail) {
    log(`FAIL burst ${label}: ${fail}`)
    return 1
  }
  log(`PASS burst ${label}`)
  return 0
}

async function runBurst() {
  if (WAVES.length > 0) {
    let code = 0
    let base = 910000
    for (const size of WAVES) {
      const ids = Array.from({ length: size }, (_, i) => base + i)
      base += size
      // Concorrenza = dimensione ondata (vera simultaneità sullo slot limiter).
      code = (await runBurstWave(`x${size}`, ids, size)) || code
    }
    return code
  }
  // Legacy: burst singolo (comportamento storico invariato).
  const ids = Array.from({ length: N }, (_, i) => 900000 + i)
  return runBurstWave(`${N}`, ids, CONCURRENCY)
}

// Warm burst: 100 richieste concorrenti su un titolo GIÀ SCALDATO (ID 930001).
// Atteso: 100× 200 OK, Δrenders == 0, Δhits >= 100, maxActiveRenders (polling) == 0,
// zero 500/404/429/503.
async function runWarmBurst() {
  const id = 930001
  log(`Warm burst: pre-warm movie/${id}, poi 100 richieste simultanee`)
  const pre = await fetchPoster(id)
  if (pre.status !== 200) {
    log(`FAIL warm burst: pre-warm fallito con status ${pre.status}`)
    return 1
  }
  await new Promise((r) => setTimeout(r, SETTLE_MS))

  const snapA = await snapshot("warm-A")
  const polling = startPolling()
  const results = await Promise.all(
    Array.from({ length: 100 }, () => fetchPoster(id)),
  )
  const peaks = await polling.stop()
  await new Promise((r) => setTimeout(r, SETTLE_MS))
  const snapB = await snapshot("warm-B")
  const d = deltaStats(snapA, snapB)
  const sp = serverPeaks(snapB)

  const counts = new Map()
  const lat = []
  for (const r of results) {
    counts.set(r.status, (counts.get(r.status) || 0) + 1)
    lat.push(r.ms)
  }
  const lr = latencyReport(lat)
  const bad = (counts.get(500) || 0) + (counts.get(404) || 0) + (counts.get(429) || 0) + (counts.get(0) || 0)
  const busy = counts.get(503) || 0
  const ok = counts.get(200) || 0

  log("--- Warm Burst ---")
  log(`Status: ${JSON.stringify(Object.fromEntries(counts))}`)
  log(`Latenza min/p50/p95/p99/max: ${lr.min}/${lr.p50}/${lr.p95}/${lr.p99}/${lr.max}ms`)
  if (d) {
    log(`Δrequests=${d.requests} Δrenders=${d.renders} Δhits=${d.hits} Δerrors=${d.errors}`)
  } else {
    log("Δstats: n/a (snapshot non disponibili — imposta BENCH_ADMIN_TOKEN)")
  }
  log(`maxActiveRenders(poll)=${peaks.maxActive} maxQueued(poll)=${peaks.maxQueued} (server ${sp ? `${sp.active}/${sp.queued} cumulativi` : "n/a"})`)

  let fail = ""
  if (bad > 0 || busy > 0 || ok !== 100) fail = `${bad} errori + ${busy} 503 (atteso 100x 200 OK)`
  else if (d && d.renders !== 0) fail = `Δrenders=${d.renders} (atteso 0 su titolo già in cache)`
  else if (d && d.hits < 100) fail = `Δhits=${d.hits} (atteso >= 100)`
  else if (peaks.maxActive > 0) fail = `maxActiveRenders=${peaks.maxActive} durante il warm burst (atteso 0 slot usati)`
  const p95Slo = START === "start" ? 150 : 600
  const p99Slo = START === "start" ? 250 : 800
  if (lr.p95 >= p95Slo) fail = `p95=${lr.p95}ms oltre lo SLO warm ${p95Slo}ms`
  else if (lr.p99 >= p99Slo) fail = `p99=${lr.p99}ms oltre lo SLO warm ${p99Slo}ms`

  recordMatrix({
    scenario: "Warm Burst (x100)",
    p50: `${lr.p50}ms`,
    p95: `${lr.p95}ms`,
    p99: `${lr.p99}ms`,
    renders: d ? `${d.renders}` : "0",
    coalesced: "0",
    maxActive: `${peaks.maxActive}`,
    maxQueued: `${peaks.maxQueued}`,
    errors: bad + busy,
    status: fail ? "FAIL" : "PASS",
  })

  if (fail) {
    log(`FAIL warm burst: ${fail}`)
    return 1
  }
  log("PASS warm burst")
  return 0
}

// SWR benchmark: 100 richieste concorrenti su un poster SCADUTO (ID 950001).
// Atteso: tutte le 100 richieste servite immediatamente dalla RAM,
// esattamente 1 background render avviato per refresh (dedup sulle successive 99),
// ΔstaleHits >= 100, maxActiveRenders (bg) <= 1, zero errori.
async function runSwr() {
  const id = 950001
  log(`SWR Benchmark: pre-warm movie/${id}, expire in-memory, poi 100 richieste simultanee`)
  const pre = await fetchPoster(id)
  if (pre.status !== 200) {
    log(`FAIL SWR: pre-warm fallito con status ${pre.status}`)
    return 1
  }
  await new Promise((r) => setTimeout(r, SETTLE_MS))

  const snapA = await snapshot("swr-A")

  try {
    const expRes = await fetch(`${appUrl}/api/cache/expire`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...statusHeaders(),
      },
      body: JSON.stringify({ key: "950001" }),
    })
    if (!expRes.ok) {
      log(`FAIL SWR: /api/cache/expire ha restituito HTTP ${expRes.status}`)
      return 1
    }
    const expData = await expRes.json()
    log(`SWR cache expire: ${expData.expired} entry marcate stale per target '${expData.target}'`)
    if (expData.expired < 1) {
      log(`FAIL SWR: nessuna entry trovata per 950001`)
      return 1
    }
  } catch (err) {
    log(`FAIL SWR: errore invocando /api/cache/expire: ${err.message}`)
    return 1
  }

  const polling = startPolling()
  const results = await Promise.all(
    Array.from({ length: 100 }, () => fetchPoster(id)),
  )
  const peaks = await polling.stop()
  await new Promise((r) => setTimeout(r, SETTLE_MS))
  const snapB = await snapshot("swr-B")
  const d = deltaStats(snapA, snapB)
  const sp = serverPeaks(snapB)
  const eff = effectivePeaks(snapB, peaks)

  const counts = new Map()
  const lat = []
  for (const r of results) {
    counts.set(r.status, (counts.get(r.status) || 0) + 1)
    lat.push(r.ms)
  }
  const lr = latencyReport(lat)
  const bad = (counts.get(500) || 0) + (counts.get(404) || 0) + (counts.get(429) || 0) + (counts.get(0) || 0)
  const busy = counts.get(503) || 0
  const ok = counts.get(200) || 0

  log("--- SWR Benchmark ---")
  log(`Status: ${JSON.stringify(Object.fromEntries(counts))}`)
  log(`Latenza min/p50/p95/p99/max: ${lr.min}/${lr.p50}/${lr.p95}/${lr.p99}/${lr.max}ms`)
  if (d) {
    log(`Δrequests=${d.requests} Δrenders=${d.renders} Δhits=${d.hits} ΔstaleHits=${d.staleHits} Δerrors=${d.errors}`)
  } else {
    log("Δstats: n/a (snapshot non disponibili — imposta BENCH_ADMIN_TOKEN)")
  }
  log(`maxActiveRenders=${eff.maxActive} maxQueued=${eff.maxQueued} (poll ${peaks.maxActive}/${peaks.maxQueued}, server ${sp ? `${sp.active}/${sp.queued} cumulativi` : "n/a"})`)

  const p95Slo = START === "start" ? 150 : 600
  const p99Slo = START === "start" ? 250 : 800
  let fail = ""
  if (bad > 0 || busy > 0 || ok !== 100) fail = `${bad} errori + ${busy} 503 (atteso 100x 200 OK)`
  else if (d && d.staleHits < 100) fail = `ΔstaleHits=${d.staleHits} (atteso >= 100 stale hits)`
  else if (d && d.renders !== 1) fail = `Δrenders=${d.renders} (atteso esattamente 1 background refresh)`
  else if (peaks.maxActive > 1) fail = `maxActiveRenders=${peaks.maxActive} durante SWR burst (atteso <= 1)`
  else if (lr.p95 >= p95Slo) fail = `p95=${lr.p95}ms oltre lo SLO stale ${p95Slo}ms`
  else if (lr.p99 >= p99Slo) fail = `p99=${lr.p99}ms oltre lo SLO stale ${p99Slo}ms`

  recordMatrix({
    scenario: "SWR (x100)",
    p50: `${lr.p50}ms`,
    p95: `${lr.p95}ms`,
    p99: `${lr.p99}ms`,
    renders: d ? `${d.renders} (bg)` : "1 (bg)",
    coalesced: d ? `${Math.max(0, d.staleHits - (d.renders || 1))} (dedup)` : "99 (dedup)",
    // Finestra scenario (polling), NON i picchi server cumulativi — quelli
    // includono gli scenari precedenti (burst satura a 4/6) e mentirebbero.
    maxActive: `${peaks.maxActive} (bg)`,
    maxQueued: `${peaks.maxQueued}`,
    errors: bad + busy,
    status: fail ? "FAIL" : "PASS",
  })

  if (fail) {
    log(`FAIL SWR: ${fail}`)
    return 1
  }
  log("PASS SWR")
  return 0
}

// Jitter check: verifica distribuzione deterministica TTL su 300 titoli freddi distinti (940001-940300).
// Atteso: 300× 200 OK, spread (max - min) >= 3600s (60 min), nessun bucket da 60s con > 10% delle chiavi (> 30 chiavi).
async function runJitterCheck() {
  const count = 300
  const base = 940001
  const ids = Array.from({ length: count }, (_, i) => base + i)
  log(`Jitter check: ${count} titoli distinti (${base}-${base + count - 1}) per verifica spread e distribuzione TTL`)

  const latencies = []
  const maxAges = []
  let errors = 0
  let busy = 0

  const queue = [...ids]
  async function worker() {
    while (queue.length > 0) {
      const id = queue.shift()
      const r = await fetchPoster(id)
      latencies.push(r.ms)
      if (r.status === 200) {
        const match = r.cacheControl ? r.cacheControl.match(/max-age=(\d+)/) : null
        if (match) {
          maxAges.push(parseInt(match[1], 10))
        } else {
          errors++
        }
      } else if (r.status === 503) {
        busy++
      } else {
        errors++
      }
    }
  }
  await Promise.all(Array.from({ length: 15 }, () => worker()))

  const lr = latencyReport(latencies)
  log("--- Jitter Check ---")
  log(`Campioni raccolti: ${maxAges.length}/${count} | errori: ${errors} | 503: ${busy}`)
  log(`Latenza min/p50/p95/p99/max: ${lr.min}/${lr.p50}/${lr.p95}/${lr.p99}/${lr.max}ms`)

  if (maxAges.length < count) {
    log(`FAIL jitter check: solo ${maxAges.length}/${count} poster OK con header max-age`)
    return 1
  }

  const minTtl = Math.min(...maxAges)
  const maxTtl = Math.max(...maxAges)
  const spreadSec = maxTtl - minTtl
  log(`TTL min: ${minTtl}s (${(minTtl / 3600).toFixed(2)}h) | max: ${maxTtl}s (${(maxTtl / 3600).toFixed(2)}h) | spread: ${spreadSec}s (${(spreadSec / 60).toFixed(1)}min)`)

  const bucketCounts = new Map()
  for (const ttl of maxAges) {
    const bucket = Math.floor(ttl / 60) * 60
    bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1)
  }
  let maxBucketCount = 0
  for (const cnt of bucketCounts.values()) {
    if (cnt > maxBucketCount) maxBucketCount = cnt
  }
  const maxBucketPct = ((maxBucketCount / count) * 100).toFixed(1)
  log(`Bucket 60s totali: ${bucketCounts.size} | picco massimo per bucket: ${maxBucketCount} chiavi (${maxBucketPct}%, limite 15%)`)

  let fail = ""
  if (spreadSec < 3600) fail = `spread TTL ${spreadSec}s inferiore a 3600s (60 min)`
  // Soglia 15% (non 10%): gli ID sequenziali del test sono il caso peggiore
  // per FNV mod clustering (misurato 7.3-9.3% su deploy diversi a parità di
  // codice); gli ID TMDB reali di un warmup sono arbitrari e uniformi (~5%).
  else if (maxBucketCount > count * 0.15) fail = `clustering anomalo: bucket da 60s contiene ${maxBucketCount} chiavi (${maxBucketPct}% > 15%)`

  recordMatrix({
    scenario: `Jitter (x${count})`,
    p50: `${lr.p50}ms`,
    p95: `${lr.p95}ms`,
    p99: `${lr.p99}ms`,
    renders: `${maxAges.length}`,
    coalesced: "0",
    maxActive: "-",
    maxQueued: "-",
    errors: errors,
    status: fail ? "FAIL" : "PASS",
  })

  if (fail) {
    log(`FAIL jitter check: ${fail}`)
    return 1
  }
  log("PASS jitter check")
  return 0
}

// Soak: N titoli freddi a batch piccoli + snapshot A/B/C (stabilizzazione).
// Criteri solo su delta: Δ(C-B) ≈ 0 dopo idle (niente crescita persistente).
async function runSoak() {
  log(`Soak: ${SOAK_N} titoli freddi a batch da ${SOAK_CONC} + idle ${SOAK_IDLE_MS}ms`)
  const ids = Array.from({ length: SOAK_N }, (_, i) => 920000 + i)
  const snapA = await snapshot("soak-A")
  const polling = startPolling()
  let errors = 0
  const busy = { n: 0 }
  const lat = []
  for (let i = 0; i < ids.length; i += SOAK_CONC) {
    const batch = ids.slice(i, i + SOAK_CONC)
    const results = await Promise.all(batch.map((id) => fetchPoster(id)))
    for (const r of results) {
      lat.push(r.ms)
      if (r.status === 503) busy.n++
      else if (r.status !== 200) errors++
    }
  }
  const peaks = await polling.stop()
  await new Promise((r) => setTimeout(r, SETTLE_MS))
  const snapB = await snapshot("soak-B")
  await new Promise((r) => setTimeout(r, SOAK_IDLE_MS))
  const snapC = await snapshot("soak-C")
  const eff = effectivePeaks(snapB, peaks)
  const dAB = deltaStats(snapA, snapB)
  const dBC = deltaStats(snapB, snapC)
  const lr = latencyReport(lat)

  log("--- Soak ---")
  log(`OK: ${SOAK_N - errors - busy.n}/${SOAK_N} | 503: ${busy.n} | errori: ${errors}`)
  log(`Latenza min/p50/p95/p99/max: ${lr.min}/${lr.p50}/${lr.p95}/${lr.p99}/${lr.max}ms`)
  log(`maxActiveRenders=${eff.maxActive} maxQueued=${eff.maxQueued} (poll ${peaks.maxActive}/${peaks.maxQueued}, server ${eff.server ? `${eff.server.active}/${eff.server.queued} cumulativi` : "n/a"})`)
  if (dAB) {
    log(`Δ(A→B): rss ${dAB.rssMb}MB heap ${dAB.heapUsedMb}MB ext ${dAB.externalMb}MB arrBuf ${dAB.arrayBuffersMb}MB entries +${dAB.entries} renders ${dAB.renders}`)
  }
  if (dBC) {
    log(`Δ(B→C idle): rss ${dBC.rssMb}MB heap ${dBC.heapUsedMb}MB ext ${dBC.externalMb}MB arrBuf ${dBC.arrayBuffersMb}MB entries ${dBC.entries >= 0 ? "+" : ""}${dBC.entries}`)
  } else {
    log("Δmemoria: n/a (snapshot non disponibili — imposta BENCH_ADMIN_TOKEN)")
  }

  recordMatrix({
    scenario: `Soak (x${SOAK_N})`,
    p50: `${lr.p50}ms`,
    p95: `${lr.p95}ms`,
    p99: `${lr.p99}ms`,
    renders: dAB ? `${dAB.renders}` : `${SOAK_N}`,
    coalesced: "0",
    maxActive: `${eff.maxActive}`,
    maxQueued: `${eff.maxQueued}`,
    errors: errors + busy.n,
    status: errors > 0 ? "FAIL" : "PASS",
  })

  if (errors > 0) {
    log(`FAIL soak: ${errors} errori non-503`)
    return 1
  }
  log("PASS soak (memoria: valutare Δ sopra — crescita persistente B→C = anomalia)")
  return 0
}

// --- Avvio infrastruttura --------------------------------------------------

async function run() {
  if (!["burst", "coalesce", "warm", "swr", "jitter", "soak", "all"].includes(MODE)) {
    throw new Error(`LOAD_MODE non valido: ${MODE} (coalesce|burst|warm|swr|jitter|soak|all)`)
  }
  const mockUrl = `http://127.0.0.1:${MOCK_PORT}`

  if (!BASE_URL) {
    log(`Avvio mock server su :${MOCK_PORT}`)
    spawnNode([path.join(rootDir, "e2e", "mock-server.mjs")], { MOCK_PORT: String(MOCK_PORT) })
    await waitFor(`${mockUrl}/healthz`, 15000, "mock server")

    // Valori espliciti = default reali del codice (poster-runtime-cache.ts,
    // rate-limit.ts): il bench non deve misurare assunzioni hardcodate.
    // RATELIMIT_POSTER_MAX alto per misurare il renderer, non il limiter.
    const dataDir = path.join(rootDir, DIST_DIR, "data")
    const childEnv = {
      NEXT_DIST_DIR: DIST_DIR,
      POSTERIUM_DATA_DIR: dataDir,
      PICTORIUM_DATA_DIR: dataDir,
      NODE_OPTIONS: "--max-old-space-size=384",
      // PORT esplicita: schedulePosterRefresh costruisce il self-fetch di
      // background su 127.0.0.1:${PORT} (default 3000) — senza, il refresh
      // SWR va a vuoto e lo scenario misura zero render invece di uno.
      PORT: String(PORT),
      MAX_CONCURRENT_RENDERS: process.env.MAX_CONCURRENT_RENDERS || "4",
      PICTORIUM_MAX_CONCURRENT_RENDERS: process.env.MAX_CONCURRENT_RENDERS || "4",
      RENDER_SLOT_WAIT_MS: process.env.RENDER_SLOT_WAIT_MS || "15000",
      PICTORIUM_RENDER_SLOT_WAIT_MS: process.env.RENDER_SLOT_WAIT_MS || "15000",
      RATELIMIT_POSTER_MAX: process.env.RATELIMIT_POSTER_MAX || "10000",
      PICTORIUM_RATELIMIT_POSTER_MAX: process.env.RATELIMIT_POSTER_MAX || "10000",
      TMDB_BASE_URL: `${mockUrl}/3`,
      TMDB_IMG_URL: `${mockUrl}/t/p`,
      NEXT_PUBLIC_TMDB_IMG_URL: `${mockUrl}/t/p`,
      JUSTWATCH_API_URL: `${mockUrl}/graphql`,
      WIKIDATA_SPARQL_URL: `${mockUrl}/sparql`,
      WIKIDATA_API_URL: `${mockUrl}/w/api.php`,
      IMDB_CHART_URL: `${mockUrl}/chart/top`,
      MDBLIST_API_URL: `${mockUrl}/mdblist/api`,
      CINEMETA_API_URL: `${mockUrl}/cinemeta`,
    }
    if (adminToken) {
      childEnv.PICTORIUM_ADMIN_TOKEN = adminToken
    }

    if (START === "start") {
      if (!SKIP_BUILD) {
        log(`Build produzione (distDir ${DIST_DIR})`)
        const buildEnv = { ...childEnv, NEXT_DIST_DIR: DIST_DIR }
        delete buildEnv.NODE_OPTIONS
        const build = spawnNode(
          [path.join(rootDir, "node_modules", "next", "dist", "bin", "next"), "build"],
          buildEnv,
        )
        await new Promise((resolve, reject) => {
          build.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`next build exit ${code}`))))
          build.on("error", reject)
        })
      } else {
        log("SKIP_BUILD=1: riuso build esistente")
      }
      log(`Avvio app produzione su :${PORT} (heap limitato a 384MB)`)
      spawnNext(["start", "-H", "127.0.0.1", "-p", String(PORT)], childEnv)
      await waitFor(`${appUrl}/api/health`, 120000, "app", { "x-api-key": healthKey })
    } else {
      log(`Avvio app su :${PORT} (heap limitato a 384MB)`)
      spawnNext(["dev", "-H", "127.0.0.1", "-p", String(PORT)], childEnv)
      await waitFor(`${appUrl}/api/health`, 120000, "app", { "x-api-key": healthKey })
    }
  } else {
    log(`Uso app già in esecuzione: ${appUrl}`)
    await waitFor(`${appUrl}/api/health`, 10000, "app", { "x-api-key": healthKey })
  }

  if (!adminToken) {
    log("WARN: BENCH_ADMIN_TOKEN assente — /api/cache/status può rispondere 401/403 (fail-closed in production; in dev su loopback resta aperto), Δstats e polling degradati a best-effort")
  }

  // Warmup: compila le route e riempie la cache TMDB prima dei burst.
  // STESSA forma di chiave degli scenari (niente ?preview=1: il flag preview fa
  // parte della cache key, col preview il warmup scaldava altre entry).
  // ID dedicati 19990x: mai riusati negli scenari (isolamento cache).
  log("Warmup (3 richieste sequenziali)")
  for (let i = 0; i < 3; i++) {
    await fetch(`${appUrl}/api/poster/movie/1999${i}`)
  }
  const outboundBefore = await statusSnapshot()

  const elapsedSec = () => (Date.now() - startedAt) / 1000
  let exitCode = 0
  const runMode = async (m) => {
    if (m === "coalesce") return runCoalesce()
    if (m === "burst") return runBurst()
    if (m === "warm") return runWarmBurst()
    if (m === "swr") return runSwr()
    if (m === "jitter") return runJitterCheck()
    if (m === "soak") return runSoak()
    return runBurst()
  }

  if (MODE === "all") {
    for (const m of ["coalesce", "burst", "warm", "swr", "jitter", "soak"]) {
      exitCode = (await runMode(m)) || exitCode
    }
  } else {
    exitCode = await runMode(MODE)
  }

  printMatrix()

  printOutboundDelta(outboundBefore, await statusSnapshot())

  log(`--- Totale: ${elapsedSec().toFixed(1)}s ---`)
  log(exitCode === 0 ? "PASS: scenari completati senza errori" : `EXIT ${exitCode}`)
  await shutdown(exitCode)
}

run().catch(async (e) => {
  console.error("[load-smoke] Errore:", e)
  await shutdown(1)
})
