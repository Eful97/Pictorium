// Load smoke test per la render pipeline poster (Fase D del piano di hardening).
//
// Avvia il mock server + l'app (o usa PICTORIUM_BASE_URL se già in esecuzione),
// poi spara N richieste concorrenti su titoli freddi non-mappati e misura:
//   - % 503 (backpressure dello slot limiter)
//   - poster/sec
//   - heap prima/dopo
//
// Assert (exit != 0): nessun errore non-503, heap finale < 250MB sull'istanza
// con heap limitato a 384MB (default del piano).
//
// Uso:
//   node scripts/load-smoke.mjs                       # avvia tutto (mock + next dev)
//   PICTORIUM_BASE_URL=http://127.0.0.1:3100 node scripts/load-smoke.mjs
//   LOAD_REQUESTS=80 LOAD_CONCURRENCY=20 node scripts/load-smoke.mjs

import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const BASE_URL = process.env.PICTORIUM_BASE_URL || process.env.POSTERIUM_BASE_URL || ""
const PORT = Number(process.env.LOAD_PORT) || 3101
const MOCK_PORT = Number(process.env.LOAD_MOCK_PORT) || 8791
const N = Number(process.env.LOAD_REQUESTS) || 40
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY) || 10
const HEAP_LIMIT_MB = Number(process.env.LOAD_HEAP_LIMIT_MB) || 250
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

async function run() {
  const mockUrl = `http://127.0.0.1:${MOCK_PORT}`

  if (!BASE_URL) {
    log(`Avvio mock server su :${MOCK_PORT}`)
    spawnNode([path.join(rootDir, "e2e", "mock-server.mjs")], { MOCK_PORT: String(MOCK_PORT) })
    await waitFor(`${mockUrl}/healthz`, 15000, "mock server")

    log(`Avvio app su :${PORT} (heap limitato a 384MB)`)
    spawnNode(
      [path.join(rootDir, "node_modules", "next", "dist", "bin", "next"), "dev", "-H", "127.0.0.1", "-p", String(PORT)],
      {
        NEXT_DIST_DIR: ".next-load",
        POSTERIUM_DATA_DIR: path.join(rootDir, ".next-load", "data"),
        PICTORIUM_DATA_DIR: path.join(rootDir, ".next-load", "data"),
        NODE_OPTIONS: "--max-old-space-size=384",
        TMDB_BASE_URL: `${mockUrl}/3`,
        TMDB_IMG_URL: `${mockUrl}/t/p`,
        NEXT_PUBLIC_TMDB_IMG_URL: `${mockUrl}/t/p`,
        JUSTWATCH_API_URL: `${mockUrl}/graphql`,
        WIKIDATA_SPARQL_URL: `${mockUrl}/sparql`,
        IMDB_CHART_URL: `${mockUrl}/chart/top`,
        MDBLIST_API_URL: `${mockUrl}/mdblist/api`,
      },
    )
    await waitFor(`${appUrl}/api/health`, 120000, "app", { "x-api-key": healthKey })
  } else {
    log(`Uso app già in esecuzione: ${appUrl}`)
    await waitFor(`${appUrl}/api/health`, 10000, "app", { "x-api-key": healthKey })
  }

  // Warmup: compila le route (dev) e riempie la cache TMDB prima del burst.
  log("Warmup (3 richieste sequenziali)")
  for (let i = 0; i < 3; i++) {
    await fetch(`${appUrl}/api/poster/movie/1999${i}?preview=1`)
  }

  const heapBefore = process.memoryUsage().heapUsed / 1024 / 1024
  log(`Heap prima: ${heapBefore.toFixed(1)} MB`)

  // Titoli freddi: id unici non-mappati → pipeline completa (no cache).
  const ids = Array.from({ length: N }, (_, i) => 900000 + i)

  log(`Burst: ${N} richieste, concorrenza ${CONCURRENCY}`)
  const statusCounts = new Map()
  const latencies = []
  let errors = 0

  async function worker(queue) {
    while (queue.length > 0) {
      const id = queue.shift()
      const start = Date.now()
      try {
        const res = await fetch(`${appUrl}/api/poster/movie/${id}`)
        const status = res.status
        statusCounts.set(status, (statusCounts.get(status) || 0) + 1)
        latencies.push(Date.now() - start)
        if (status === 500) errors++
        if (status === 429) errors++
      } catch (e) {
        errors++
        log(`Errore di rete su movie/${id}: ${e.message}`)
      }
    }
  }

  const queue = [...ids]
  const workers = Array.from({ length: CONCURRENCY }, () => worker(queue))
  await Promise.all(workers)

  const heapAfter = process.memoryUsage().heapUsed / 1024 / 1024
  const elapsedSec = (Date.now() - startedAt) / 1000
  const total = ids.length
  const ok = statusCounts.get(200) || 0
  const busy = statusCounts.get(503) || 0
  const notFound = statusCounts.get(404) || 0
  const pct503 = ((busy / total) * 100).toFixed(1)
  const pct404 = ((notFound / total) * 100).toFixed(1)
  latencies.sort((a, b) => a - b)
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0

  log("--- Risultati ---")
  log(`Status: ${JSON.stringify(Object.fromEntries(statusCounts))}`)
  log(`% 503: ${pct503}%  | % 404: ${pct404}%  | errori rete/500/429: ${errors}`)
  log(`Poster OK: ${ok}/${total} in ${elapsedSec.toFixed(1)}s (~${(ok / elapsedSec).toFixed(1)}/s)`)
  log(`Latenza p50: ${p50}ms | p95: ${p95}ms`)
  log(`Heap: ${heapBefore.toFixed(1)} MB → ${heapAfter.toFixed(1)} MB (limite ${HEAP_LIMIT_MB} MB)`)

  let exitCode = 0
  if (errors > 0) {
    log(`FAIL: ${errors} errori 500/429/rete`)
    exitCode = 1
  }
  if (heapAfter > HEAP_LIMIT_MB) {
    log(`FAIL: heap ${heapAfter.toFixed(1)} MB oltre il limite ${HEAP_LIMIT_MB} MB`)
    exitCode = 1
  }
  if (ok === 0 && total > 0) {
    log("FAIL: nessun poster servito")
    exitCode = 1
  }

  log(exitCode === 0 ? "PASS: nessun OOM, heap sotto il limite" : `EXIT ${exitCode}`)
  await shutdown(exitCode)
}

run().catch(async (e) => {
  console.error("[load-smoke] Errore:", e)
  await shutdown(1)
})
