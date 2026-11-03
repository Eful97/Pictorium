import { execFile } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import snapshotData from "@/generated/anime-id-map.json"
import {
  animeMapInfo,
  createAnimeIdMapResolver,
  findAnimeByImdb,
  findAnimeByTmdb,
  parseAnimeNamespace,
  resolveAnimeArtwork,
} from "@/lib/anime-id-map"

const SMALL = [
  { a: 164, k: 142, m: 164, d: 7, t: 128, y: "movie", i: ["tt0119698"] },
  { a: 290, k: 265, t: 26209, y: "tv", s: 1, i: ["tt0286390"] },
  { a: 396, k: 266, t: 26209, y: "tv", s: 2 },
  { a: 3120, k: 2809, t: 34775, y: "movie", i: ["tt0185196"] },
  { a: 1693, k: 1521, t: 34775, y: "tv", s: 1, i: ["tt0989787"] },
  { a: 999001, t: 73529, y: "movie" },
  { a: 999001, t: 73530, y: "movie" },
  { k: 777, t: 555, y: "tv" },
  { t: 1, y: "tv" },
  null,
  "garbage",
  { a: -3, t: -1, y: "tv" },
  // Snapshot untrusted: id frazionari / stringhe parziali non indicizzati.
  { a: 16.5, k: 778.5, t: 556, y: "tv" },
  { a: "164junk", k: 779, t: 557, y: "tv" },
] as unknown[]

describe("anime-id-map resolver (lookup semantics)", () => {
  it("resolves movie and series artwork where unique", () => {
    const r = createAnimeIdMapResolver(SMALL)
    expect(r.resolveArtwork("anilist", 164, "movie")).toEqual({ status: "resolved", tmdbId: 128, tmdbSide: "movie" })
    expect(r.resolveArtwork("kitsu", 265, "tv")).toEqual({ status: "resolved", tmdbId: 26209, tmdbSide: "tv" })
    expect(r.resolveArtwork("mal", 164, "movie")).toEqual({ status: "resolved", tmdbId: 128, tmdbSide: "movie" })
    expect(r.resolveArtwork("anidb", 7, "movie")).toEqual({ status: "resolved", tmdbId: 128, tmdbSide: "movie" })
  })

  it("is case-insensitive on namespace and strict on media side", () => {
    const r = createAnimeIdMapResolver(SMALL)
    expect(r.resolveArtwork("AniList", 164, "movie").status).toBe("resolved")
    // Media-type incompatibile: 164 esiste solo sul lato movie.
    expect(r.resolveArtwork("anilist", 164, "tv")).toEqual({ status: "missing" })
    expect(r.resolveArtwork("anilist", 164, "ova")).toEqual({ status: "missing" })
    expect(r.resolveArtwork("anilist", 164, null)).toEqual({ status: "missing" })
  })

  it("rejects invalid ids without throwing", () => {
    const r = createAnimeIdMapResolver(SMALL)
    for (const bad of [0, -5, "xx", null, undefined, NaN, "", "164junk", "12ab34", "3.5", 3.5, 16.5, Infinity, Number.MAX_SAFE_INTEGER + 1, "0x10", "1e3", {}, []]) {
      expect(r.resolveArtwork("anilist", bad, "movie")).toEqual({ status: "missing" })
    }
    expect(r.resolveArtwork("unknown-ns", 164, "movie")).toEqual({ status: "missing" })
    expect(r.resolveArtwork(null, 164, "movie")).toEqual({ status: "missing" })
    // Numeriche intere come stringa restano accettate…
    expect(r.resolveArtwork("anilist", "164", "movie")).toMatchObject({ status: "resolved", tmdbId: 128 })
    expect(r.findByTmdb("128", "movie")).toHaveLength(1)
    // …ma parziali/frazionarie mai.
    expect(r.findByTmdb("128junk")).toEqual([])
    expect(r.findByTmdb(128.5)).toEqual([])
  })

  it("never first-picks on conflicts (ambiguous)", () => {
    const r = createAnimeIdMapResolver(SMALL)
    // anilist 999001 -> due film diversi: ambiguo, non il primo.
    expect(r.resolveArtwork("anilist", 999001, "movie")).toEqual({ status: "ambiguous" })
  })

  it("missing optional fields do not invalidate usable associations", () => {
    const r = createAnimeIdMapResolver(SMALL)
    // Solo kitsu noto, senza imdb/stagione: risolve comunque.
    expect(r.resolveArtwork("kitsu", 777, "tv")).toEqual({ status: "resolved", tmdbId: 555, tmdbSide: "tv" })
  })

  it("reverse lookup preserves ALL matches (seasons sharing a show)", () => {
    const r = createAnimeIdMapResolver(SMALL)
    const matches = r.findByTmdb(26209, "tv")
    expect(matches).toHaveLength(2)
    expect(matches.map((m) => m.a).sort()).toEqual([290, 396])
    // Senza lato: unisce movie+tv; con lato: solo quel lato.
    expect(r.findByTmdb(128)).toHaveLength(1)
    expect(r.findByTmdb(128, "tv")).toHaveLength(0)
    expect(r.findByTmdb("nope")).toHaveLength(0)
    expect(r.findByTmdb(-1)).toHaveLength(0)
  })

  it("reverse imdb lookup is syntax-validated", () => {
    const r = createAnimeIdMapResolver(SMALL)
    expect(r.findByImdb("tt0119698")).toHaveLength(1)
    expect(r.findByImdb("TT0119698")).toHaveLength(1)
    expect(r.findByImdb("tt0000000")).toHaveLength(0)
    expect(r.findByImdb("not-an-id")).toHaveLength(0)
    expect(r.findByImdb(null)).toHaveLength(0)
    // Filtro lato: l'imdb del film non è prestato alle serie.
    expect(r.findByImdb("tt0119698", "tv")).toHaveLength(0)
    expect(r.findByImdb("tt0119698", "movie")).toHaveLength(1)
    expect(r.findByImdb("tt0286390", "movie")).toHaveLength(0)
    expect(r.findByImdb("tt0286390", "tv")).toHaveLength(1)
  })

  it("snapshot ids are strictly validated (no partial/fractional indexing)", () => {
    const r = createAnimeIdMapResolver(SMALL)
    // a:16.5 frazionario mai indicizzato…
    expect(r.resolveArtwork("anilist", 16.5, "tv")).toEqual({ status: "missing" })
    expect(r.resolveArtwork("kitsu", 778.5, "tv")).toEqual({ status: "missing" })
    // …a:"164junk" stringa mai indicizzata (e kitsu:779 della stessa riga resta valido).
    expect(r.resolveArtwork("anilist", "164junk", "tv")).toEqual({ status: "missing" })
    expect(r.resolveArtwork("kitsu", 779, "tv")).toMatchObject({ status: "resolved", tmdbId: 557 })
  })

  it("same numeric id on both sides stays separated", () => {
    const r = createAnimeIdMapResolver(SMALL)
    // tmdb 34775 esiste sia come film (a3120) sia come serie (a1693).
    expect(r.resolveArtwork("anilist", 3120, "movie")).toMatchObject({ status: "resolved", tmdbId: 34775 })
    expect(r.resolveArtwork("anilist", 3120, "tv")).toEqual({ status: "missing" })
    expect(r.resolveArtwork("anilist", 1693, "tv")).toMatchObject({ status: "resolved", tmdbId: 34775 })
    expect(r.resolveArtwork("anilist", 1693, "movie")).toEqual({ status: "missing" })
    expect(r.findByTmdb(34775, "movie").map((m) => m.a)).toEqual([3120])
    expect(r.findByTmdb(34775, "tv").map((m) => m.a)).toEqual([1693])
    expect(r.findByTmdb(34775)).toHaveLength(2)
  })

  it("unavailable snapshot: everything misses, never throws", () => {
    const r = createAnimeIdMapResolver([])
    expect(r.info().available).toBe(false)
    expect(r.resolveArtwork("anilist", 164, "movie")).toEqual({ status: "unavailable" })
    expect(r.findByTmdb(128)).toEqual([])
    expect(r.findByImdb("tt0119698")).toEqual([])
    const broken = createAnimeIdMapResolver("not-an-array" as unknown as never[])
    expect(broken.resolveArtwork("anilist", 164, "movie")).toEqual({ status: "unavailable" })
  })

  it("bundled snapshot is available, versioned and sizable", () => {
    const info = animeMapInfo()
    expect(info.available).toBe(true)
    expect(info.schemaVersion).toBe(1)
    expect(typeof info.sourceRevision).toBe("string")
    expect(info.sourceRevision).toMatch(/^[0-9a-f]{40}$/)
    expect(info.recordCount).toBeGreaterThan(1000)
    // Forward reale: film + serie.
    expect(resolveAnimeArtwork("anilist", 164, "movie")).toMatchObject({ status: "resolved", tmdbId: 128 })
    expect(resolveAnimeArtwork("anilist", 290, "tv")).toMatchObject({ status: "resolved", tmdbId: 26209 })
    // Reverse reale: 7 stagioni sullo stesso show preservate.
    expect(findAnimeByTmdb(26209, "tv").length).toBeGreaterThan(1)
    // Reverse reale unico: un solo record.
    expect(findAnimeByImdb("tt0119698")).toHaveLength(1)
  })

  it("parseAnimeNamespace accepts only known namespaces", () => {
    expect(parseAnimeNamespace("anilist")).toBe("anilist")
    expect(parseAnimeNamespace("KITSU")).toBe("kitsu")
    expect(parseAnimeNamespace("mal")).toBe("mal")
    expect(parseAnimeNamespace("anidb")).toBe("anidb")
    expect(parseAnimeNamespace("tmdb")).toBeNull()
    expect(parseAnimeNamespace("")).toBeNull()
    expect(parseAnimeNamespace(null)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Generator: ambiguity stats in meta + --check staleness gate (offline
// fixtures + a loopback HTTP stub; no external network in the test suite).
// ---------------------------------------------------------------------------

const SCRIPT = path.resolve(process.cwd(), "scripts/build-anime-id-map.mjs")
const FIXTURE = path.resolve(process.cwd(), "src/__tests__/fixtures/anime-id-map-fixture.json")
const execFileAsync = promisify(execFile)

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

async function runScript(args: string[]): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [SCRIPT, ...args], { cwd: process.cwd() })
    return { code: 0, stdout: String(stdout), stderr: String(stderr) }
  } catch (e) {
    const err = e as { code?: number | string; stdout?: string; stderr?: string }
    return {
      code: typeof err.code === "number" ? err.code : 1,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? ""),
    }
  }
}

async function buildFixtureSnapshot(dir: string): Promise<string> {
  const out = path.join(dir, "anime-id-map.json")
  const res = await runScript([
    "--input", FIXTURE,
    "--revision", "abc123",
    "--output", out,
    "--generated-at", "2026-01-01T00:00:00Z",
    "--min-records", "1",
  ])
  expect(res.code).toBe(0)
  return out
}

async function withStubServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  fn: (url: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("stub server has no port")
  try {
    await fn(`http://127.0.0.1:${address.port}/commits`)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  }
}

describe("build-anime-id-map: ambiguity stats + --check", () => {
  it("emits forward-conflict, side-collision and skip stats in meta.counts", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anime-map-stats-"))
    const out = await buildFixtureSnapshot(dir)
    const snap = JSON.parse(fs.readFileSync(out, "utf-8"))
    // Fixture: anilist 164 -> {128,129} e 999001 -> {73529,73530};
    // kitsu 142/999002 seguono le stesse righe multi-target.
    expect(snap.meta.counts.ambiguity).toEqual({
      forwardKeys: { anilist: 5, kitsu: 5, mal: 4, anidb: 4 },
      forwardConflicts: { anilist: 2, kitsu: 2, mal: 0, anidb: 0 },
      forwardConflictTotal: 4,
      tmdbSideCollisions: 0,
    })
    // Motivi di scarto già pubblicati, invariati.
    expect(snap.meta.counts.skipped).toEqual({ noTmdbTarget: 2, noAnimeId: 1, invalidRow: 2 })
    expect(JSON.stringify(snap.meta.counts.ambiguity)).not.toContain("null")
  })

  it("counts real cross-side TMDB collisions in the bundled snapshot and never first-picks", () => {
    // Ricomputazione dalla stessa fonte usata dal generator (nessuna copia
    // manuale di numeri che cambiano a ogni repin).
    const records = (snapshotData as { records: Record<string, unknown>[] }).records
    const fields: Record<string, string> = { anilist: "a", kitsu: "k", mal: "m", anidb: "d" }
    const forward = new Map<string, Set<number>>()
    const sidesByTmdb = new Map<number, Set<string>>()
    for (const rec of records) {
      const tmdbId = rec.t as number
      const side = rec.y as string
      for (const [ns, field] of Object.entries(fields)) {
        const id = rec[field]
        if (typeof id !== "number") continue
        const key = `${ns}:${id}:${side}`
        const targets = forward.get(key)
        if (targets) targets.add(tmdbId)
        else forward.set(key, new Set([tmdbId]))
      }
      const sides = sidesByTmdb.get(tmdbId)
      if (sides) sides.add(side)
      else sidesByTmdb.set(tmdbId, new Set([side]))
    }
    const conflicts = [...forward.entries()].filter(([, targets]) => targets.size > 1)
    expect(conflicts.length).toBeGreaterThan(0)
    for (const [key, targets] of conflicts) {
      const [ns, id, side] = key.split(":")
      expect(resolveAnimeArtwork(ns, id, side)).toEqual({ status: "ambiguous" })
      expect(targets.size).toBeGreaterThan(1)
    }
    // Nessun falso ambiguo sulle chiavi a target unico.
    for (const [key, targets] of forward) {
      if (targets.size !== 1) continue
      const [ns, id, side] = key.split(":")
      expect(resolveAnimeArtwork(ns, id, side)).toMatchObject({ status: "resolved" })
    }
    // Collisioni movie/tv reali: lo stesso id TMDB vive su due lati distinti.
    const collisions = [...sidesByTmdb.entries()].filter(([, sides]) => sides.size > 1)
    expect(collisions.length).toBeGreaterThan(0)
  })

  it("--check is offline-deterministic with --upstream-sha (fresh 0 / stale 1)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anime-map-check-"))
    const out = await buildFixtureSnapshot(dir)
    const before = fs.readFileSync(out, "utf-8")

    const fresh = await runScript(["--check", "--snapshot", out, "--upstream-sha", "abc123"])
    expect(fresh.code).toBe(0)
    expect(fresh.stdout).toContain("up to date")

    const stale = await runScript(["--check", "--snapshot", out, "--upstream-sha", "DEF456"])
    expect(stale.code).toBe(1)
    expect(stale.stdout).toContain("STALE")
    expect(stale.stdout).toContain("abc123")
    expect(stale.stdout).toContain("def456")

    // Read-only: la modalità check non tocca lo snapshot.
    expect(fs.readFileSync(out, "utf-8")).toBe(before)
  })

  it("--check detects a stale pin through the upstream API (loopback stub)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anime-map-check-net-"))
    const out = await buildFixtureSnapshot(dir)

    await withStubServer(
      (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ sha: "abc123" }))
      },
      async (url) => {
        const res = await runScript(["--check", "--snapshot", out, "--upstream-api", url])
        expect(res.code).toBe(0)
        expect(res.stdout).toContain("up to date")
      },
    )

    await withStubServer(
      (_req, res) => {
        res.writeHead(200, { "content-type": "application/json" })
        // Anche il formato ref (`object.sha`) è accettato.
        res.end(JSON.stringify({ object: { sha: "0123456789abcdef0123456789abcdef01234567" } }))
      },
      async (url) => {
        const res = await runScript(["--check", "--snapshot", out, "--upstream-api", url])
        expect(res.code).toBe(1)
        expect(res.stdout).toContain("STALE")
      },
    )
  })

  it("--check treats an unchanged ETag (304) as fresh and skips the body", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anime-map-check-etag-"))
    const out = await buildFixtureSnapshot(dir)
    let seenIfNoneMatch: string | undefined

    await withStubServer(
      (req, res) => {
        seenIfNoneMatch = req.headers["if-none-match"]
        res.writeHead(304, { etag: '"etag-1"' })
        res.end()
      },
      async (url) => {
        const res = await runScript([
          "--check", "--snapshot", out, "--upstream-api", url, "--upstream-etag", '"etag-1"',
        ])
        expect(res.code).toBe(0)
        expect(res.stdout).toContain("up to date")
      },
    )
    expect(seenIfNoneMatch).toBe('"etag-1"')
  })

  it("--fetch downloads the upstream file and rebuilds in one invocation", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anime-map-fetch-"))
    const input = path.join(dir, "anime-list-full.json")
    const out = path.join(dir, "anime-id-map.json")
    const upstreamRaw = fs.readFileSync(FIXTURE, "utf-8")

    await withStubServer(
      (req, res) => {
        if (req.url === "/commits") {
          res.writeHead(200, { "content-type": "application/json", etag: '"rev-etag"' })
          res.end(JSON.stringify({ sha: "feedbeef" }))
          return
        }
        if (req.url === "/raw/feedbeef/anime-list-full.json") {
          res.writeHead(200, { "content-type": "application/json" })
          res.end(upstreamRaw)
          return
        }
        res.writeHead(404)
        res.end()
      },
      async (url) => {
        const rawBase = url.replace(/\/commits$/, "/raw")
        const res = await runScript([
          "--fetch",
          "--input", input,
          "--upstream-api", url,
          "--raw-base", rawBase,
          "--output", out,
          "--generated-at", "2026-01-01T00:00:00Z",
          "--min-records", "1",
        ])
        expect(res.code).toBe(0)
        expect(res.stdout).toContain("fetched anime-list-full.json rev=feedbeef")
      },
    )

    // Input scritto verbatim, snapshot ricostruito con la revisione risolta
    // e l'ETag del probe upstream conservato per il futuro --check.
    expect(fs.readFileSync(input, "utf-8")).toBe(upstreamRaw)
    const snap = JSON.parse(fs.readFileSync(out, "utf-8"))
    expect(snap.meta.sourceRevision).toBe("feedbeef")
    expect(snap.meta.sourceETag).toBe('"rev-etag"')
    expect(snap.records).toHaveLength(7)
  })

  it("--check exits 2 when the pin or the upstream revision cannot be established", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anime-map-check-bad-"))
    const noRevision = path.join(dir, "no-revision.json")
    fs.writeFileSync(noRevision, JSON.stringify({ meta: {}, records: [] }))
    expect((await runScript(["--check", "--snapshot", noRevision, "--upstream-sha", "abc123"])).code).toBe(2)

    const missing = path.join(dir, "missing.json")
    expect((await runScript(["--check", "--snapshot", missing, "--upstream-sha", "abc123"])).code).toBe(2)

    // Upstream irraggiungibile: non verificabile, mai dichiarato fresco.
    const closed = await withClosedPort()
    const out = await buildFixtureSnapshot(dir)
    const offline = await runScript(["--check", "--snapshot", out, "--upstream-api", closed])
    expect(offline.code).toBe(2)
    expect(offline.stderr).toContain("cannot reach upstream")
  })
})

/** Porta certamente chiusa: server effimero aperto e chiuso subito. */
async function withClosedPort(): Promise<string> {
  const server = http.createServer()
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("no port")
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  return `http://127.0.0.1:${address.port}/commits`
}
