// Benchmark mirato: guadagno delle cache image-level (colori badge, resize
// logo, resize backdrop) sui render ripetuti dello stesso titolo.
//
// Contesto: la cache poster è keyed su TUTTI i parametri — due richieste per lo
// stesso titolo con cache key diverse (config token, rank, versione mapping,
// tick di preview) ri-eseguono l'intera pipeline sharp, inclusi i passaggi
// ripetitivi che dipendono solo dall'immagine sorgente. Le cache image-level
// (poster-service.ts) li saltano dopo il primo render.
//
// Disegno del benchmark:
//   Fase A (baseline, cache image-level INUTILE): N richieste con path
//     poster/logo/backdrop UNICI → estrazione colori + resize si ripetono a
//     ogni richiesta (comportamento pre-cache).
//   Fase B (cached): N richieste con gli STESSI path, variando solo un
//     parametro neutro `x` (cambia la cache key del poster ma non il
//     rendering) → dopo la prima richiesta colori/logo/backdrop sono serviti
//     dalla cache.
//   Le richieste usano il ramo `?poster=&logo=&backdrop=` della route (mock
//   server senza loghi/backdrop di default) per esercitare TUTTE e tre le
//   cache; `ranking=0` isola il puro lavoro immagini.
//
// Output: avg/p50/p95 per fase, delta % (B più veloce di A), e controllo
// sha256 dei body — devono essere TUTTI identici (stesso mock image + stessi
// parametri di resa): se un hash differisce, le cache hanno cambiato l'output.
//
// Uso:
//   node scripts/bench-image-cache.mjs
//   PICTORIUM_BASE_URL=http://127.0.0.1:3100 node scripts/bench-image-cache.mjs
//   BENCH_N=25 node scripts/bench-image-cache.mjs

import { spawn } from "node:child_process"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const BASE_URL = process.env.PICTORIUM_BASE_URL || process.env.POSTERIUM_BASE_URL || ""
const PORT = Number(process.env.BENCH_PORT) || 3102
const MOCK_PORT = Number(process.env.BENCH_MOCK_PORT) || 8792
const N = Number(process.env.BENCH_N) || 25
const appUrl = BASE_URL || `http://127.0.0.1:${PORT}`

function log(msg) {
  console.log(`[bench-image-cache] ${msg}`)
}

async function waitFor(url, timeoutMs, label, headers = {}) {
  const deadline = Date.now() + timeoutMs
  let lastBody = ""
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { headers })
      if (res.ok) return
      lastBody = (await res.text()).slice(0, 400)
    } catch {
      // non ancora pronto
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Timeout attendendo ${label} (${url}) — ultima risposta: ${lastBody || "nessuna risposta"}`)
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

// Stessa chiave di salute del load-smoke: /api/health senza chiave è 503 (S9).
const healthKey = process.env.BENCH_HEALTH_KEY || "mock-key"

function posterUrl(i, phase) {
  const u = new URL(`${appUrl}/api/poster/movie/424242`)
  if (phase === "A") {
    // Path unici: ogni richiesta deve rifare estrazione colori + resize.
    u.searchParams.set("poster", `/bench/p${i}.jpg`)
    u.searchParams.set("logo", `/bench/l${i}.png`)
    u.searchParams.set("backdrop", `/bench/b${i}.jpg`)
  } else {
    // Path fissi: dopo la prima richiesta le cache image-level rispondono.
    u.searchParams.set("poster", "/bench/p.jpg")
    u.searchParams.set("logo", "/bench/l.png")
    u.searchParams.set("backdrop", "/bench/b.jpg")
    // Parametro neutro: cambia la cache key del poster ma non il rendering.
    u.searchParams.set("x", String(i))
  }
  u.searchParams.set("ranking", "0")
  u.searchParams.set("voteAverage", "7.5")
  u.searchParams.set("genreName", "Action")
  u.searchParams.set("tl", "0")
  return u.toString()
}

async function request(url) {
  const t0 = Date.now()
  const res = await fetch(url)
  const buf = Buffer.from(await res.arrayBuffer())
  return {
    ms: Date.now() - t0,
    status: res.status,
    hash: crypto.createHash("sha256").update(buf).digest("hex"),
  }
}

function stats(samples) {
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b)
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length
  const p50 = sorted[Math.floor(sorted.length * 0.5)]
  const p95 = sorted[Math.floor(sorted.length * 0.95)]
  return { avg, p50, p95 }
}

async function run() {
  if (!BASE_URL) {
    const mockUrl = `http://127.0.0.1:${MOCK_PORT}`
    log(`Avvio mock server su :${MOCK_PORT}`)
    spawnNode([path.join(rootDir, "e2e", "mock-server.mjs")], { MOCK_PORT: String(MOCK_PORT) })
    await waitFor(`${mockUrl}/healthz`, 15000, "mock server")

    log(`Avvio app su :${PORT} (heap limitato a 384MB)`)
    spawnNode(
      [path.join(rootDir, "node_modules", "next", "dist", "bin", "next"), "dev", "-H", "127.0.0.1", "-p", String(PORT)],
      {
        NEXT_DIST_DIR: ".next-bench",
        POSTERIUM_DATA_DIR: path.join(rootDir, ".next-bench", "data"),
        PICTORIUM_DATA_DIR: path.join(rootDir, ".next-bench", "data"),
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

  // Warmup: prima richiesta di ogni fase (compila le route, riempie badge PNG
  // cache e altre cache one-shot) — esclusa dalle statistiche.
  log(`Warmup (1 richiesta per fase, poi ${N} misurate per fase)`)
  await request(posterUrl(0, "A"))
  await request(posterUrl(0, "B"))

  const phaseA = []
  for (let i = 1; i <= N; i++) phaseA.push(await request(posterUrl(i, "A")))
  const phaseB = []
  for (let i = 1; i <= N; i++) phaseB.push(await request(posterUrl(i, "B")))

  const aStats = stats(phaseA)
  const bStats = stats(phaseB)
  const fmt = (s) => `${Math.round(s.avg)}ms avg | p50 ${Math.round(s.p50)}ms | p95 ${Math.round(s.p95)}ms`
  const delta = (a, b) => `${(((a - b) / a) * 100).toFixed(1)}%`

  log("--- Risultati ---")
  log(`Fase A (path unici, cache image-level non utile): ${fmt(aStats)}`)
  log(`Fase B (stessi path, cache attiva):               ${fmt(bStats)}`)
  log(`Delta: p50 ${delta(aStats.p50, bStats.p50)} | p95 ${delta(aStats.p95, bStats.p95)} | avg ${delta(aStats.avg, bStats.avg)}`)

  const allSamples = [...phaseA, ...phaseB]
  const allOk = allSamples.every((s) => s.status === 200)
  const allSameHash = new Set(allSamples.map((s) => s.hash)).size === 1
  log(`Status: tutti 200 = ${allOk ? "sì" : "NO"} (${allSamples.map((s) => s.status).join(",")})`)
  log(`Body sha256: ${allSamples.length}/${allSamples.length} identici → output visivo invariato = ${allSameHash ? "sì" : "NO!"}`)

  let exitCode = 0
  if (!allOk) {
    log("FAIL: status non-200 nelle richieste")
    exitCode = 1
  }
  if (!allSameHash) {
    log("FAIL: i body differiscono — le cache hanno cambiato l'output!")
    exitCode = 1
  }
  if (bStats.p50 >= aStats.p50) {
    log("FAIL: nessun guadagno misurabile sulla p50")
    exitCode = 1
  }

  log(exitCode === 0 ? "PASS: cache attive più veloci e output invariato" : `EXIT ${exitCode}`)
  await shutdown(exitCode)
}

run().catch(async (e) => {
  console.error("[bench-image-cache] Errore:", e)
  await shutdown(1)
})
